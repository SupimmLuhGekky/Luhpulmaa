import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDbDate, toDbDate, type LocalDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { isLiability, netWorthGroup } from "@/lib/accounts/types";

/**
 * Rebuilds daily balance history for accounts by walking backwards from today's
 * balance through their transactions, then derives daily net-worth snapshots.
 *
 * Used after a bank connection's first sync so charts have history immediately.
 * Existing snapshots are never overwritten (real observations win over estimates).
 */
export async function reconstructHistory(userId: string, accountIds: string[], today: LocalDate, days = 180) {
  if (!accountIds.length) return { accountSnapshots: 0, netWorthSnapshots: 0 };
  const from = addDays(today, -days);
  const accounts = await prisma.account.findMany({
    where: { userId, id: { in: accountIds } },
    select: { id: true, type: true, currentBalanceCents: true },
  });
  const sums = await prisma.transaction.groupBy({
    by: ["accountId", "date"],
    where: { userId, accountId: { in: accountIds }, date: { gt: toDbDate(from), lte: toDbDate(today) } },
    _sum: { amountCents: true },
  });
  const byAccount = new Map<string, Map<LocalDate, number>>();
  for (const s of sums) {
    const m = byAccount.get(s.accountId) ?? new Map<LocalDate, number>();
    m.set(fromDbDate(s.date), toCents(s._sum.amountCents));
    byAccount.set(s.accountId, m);
  }

  const balances = new Map<string, Map<LocalDate, number>>();
  const rows: Prisma.AccountBalanceSnapshotCreateManyInput[] = [];
  for (const a of accounts) {
    const liability = isLiability(a.type);
    const flows = byAccount.get(a.id) ?? new Map();
    const series = new Map<LocalDate, number>();
    let balance = toCents(a.currentBalanceCents);
    for (let d = today; d >= from; d = addDays(d, -1)) {
      series.set(d, balance);
      rows.push({ userId, accountId: a.id, date: toDbDate(d), balanceCents: balance });
      const flow = flows.get(d) ?? 0;
      // Undo the day's activity: assets lose inflows, liabilities regain purchases.
      balance = liability ? balance + flow : balance - flow;
    }
    balances.set(a.id, series);
  }
  const accountResult = await prisma.accountBalanceSnapshot.createMany({ data: rows, skipDuplicates: true });

  // Net worth uses every account in net worth; accounts without history keep today's balance.
  const all = await prisma.account.findMany({ where: { userId, includeInNetWorth: true, status: { not: "CLOSED" } }, select: { id: true, type: true, currentBalanceCents: true } });
  const nwRows: Prisma.NetWorthSnapshotCreateManyInput[] = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    let assets = 0;
    let liabilities = 0;
    const breakdown: Record<string, number> = {};
    for (const a of all) {
      const bal = balances.get(a.id)?.get(d) ?? toCents(a.currentBalanceCents);
      const group = netWorthGroup(a.type);
      breakdown[group] = (breakdown[group] ?? 0) + bal;
      if (isLiability(a.type)) liabilities += bal;
      else assets += bal;
    }
    nwRows.push({
      userId,
      date: toDbDate(d),
      assetsCents: assets,
      liabilitiesCents: liabilities,
      netWorthCents: assets - liabilities,
      breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, String(v)])),
    });
  }
  const nwResult = await prisma.netWorthSnapshot.createMany({ data: nwRows, skipDuplicates: true });
  return { accountSnapshots: accountResult.count, netWorthSnapshots: nwResult.count };
}
