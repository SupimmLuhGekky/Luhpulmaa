import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, addMonths, fromDbDate, startOfMonth, startOfYear, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { calculateNetWorth, type NetWorthResult } from "@/lib/finance/calculations";
import { toCents } from "@/lib/finance/money";
import { convertToBase } from "@/lib/finance/fx";
import { isLiability, netWorthGroup } from "@/lib/accounts/types";
import { accountContributions, netWorthRangeStart, type AccountBalanceInput, type NetWorthRange } from "./contributions";

/** Current net worth from visible, active accounts marked "include in net worth". */
export async function currentNetWorth(userId: string): Promise<NetWorthResult & { accountCount: number }> {
  const [accounts, user] = await Promise.all([
    prisma.account.findMany({ where: { userId, includeInNetWorth: true, status: { not: "CLOSED" } }, select: { type: true, currentBalanceCents: true, currency: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { currency: true } }),
  ]);
  const items = await Promise.all(
    accounts.map(async (a) => ({
      balance: await convertToBase(userId, toCents(a.currentBalanceCents), a.currency, user.currency),
      class: isLiability(a.type) ? ("liability" as const) : ("asset" as const),
      group: netWorthGroup(a.type),
    })),
  );
  return { ...calculateNetWorth(items), accountCount: accounts.length };
}

/** Upserts today's snapshot (idempotent per day). */
export async function recordNetWorthSnapshot(userId: string, date: LocalDate) {
  const nw = await currentNetWorth(userId);
  const breakdown = Object.fromEntries(Object.entries(nw.breakdown).map(([k, v]) => [k, String(v)])) as Prisma.InputJsonValue;
  await prisma.netWorthSnapshot.upsert({
    where: { userId_date: { userId, date: toDbDate(date) } },
    update: { assetsCents: nw.assets, liabilitiesCents: nw.liabilities, netWorthCents: nw.netWorth, breakdown },
    create: { userId, date: toDbDate(date), assetsCents: nw.assets, liabilitiesCents: nw.liabilities, netWorthCents: nw.netWorth, breakdown },
  });
  return nw;
}

export async function netWorthHistory(userId: string, from: LocalDate, to: LocalDate) {
  const rows = await prisma.netWorthSnapshot.findMany({ where: { userId, date: { gte: toDbDate(from), lte: toDbDate(to) } }, orderBy: { date: "asc" } });
  return rows.map((r) => ({ date: fromDbDate(r.date), assets: toCents(r.assetsCents), liabilities: toCents(r.liabilitiesCents), netWorth: toCents(r.netWorthCents) }));
}

/** Net worth at the latest snapshot on or before `date` (null when no history). */
async function netWorthAt(userId: string, date: LocalDate): Promise<number | null> {
  const row = await prisma.netWorthSnapshot.findFirst({ where: { userId, date: { lte: toDbDate(date) } }, orderBy: { date: "desc" } });
  return row ? toCents(row.netWorthCents) : null;
}

export async function netWorthSummary(userId: string, today: LocalDate) {
  const current = await currentNetWorth(userId);
  const [monthStart, yearStart, oneYearAgo] = await Promise.all([
    netWorthAt(userId, addDays(startOfMonth(today), -1)),
    netWorthAt(userId, addDays(startOfYear(today), -1)),
    netWorthAt(userId, addMonths(today, -12)),
  ]);
  return {
    ...current,
    changeThisMonth: monthStart === null ? null : current.netWorth - monthStart,
    changeThisYear: yearStart === null ? null : current.netWorth - yearStart,
    change12Months: oneYearAgo === null ? null : current.netWorth - oneYearAgo,
  };
}

/** Each account's balance on `date`: its latest snapshot on or before that day. */
async function balancesOn(userId: string, date: LocalDate): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ accountId: string; balanceCents: bigint }[]>`
    SELECT DISTINCT ON ("accountId") "accountId", "balanceCents"
    FROM "account_balance_snapshots"
    WHERE "userId" = ${userId}::uuid AND "date" <= ${toDbDate(date)}
    ORDER BY "accountId", "date" DESC`;
  return new Map(rows.map((r) => [r.accountId, toCents(r.balanceCents)]));
}

/**
 * Per-account contribution to net worth (same accounts and conversion as
 * currentNetWorth), with each account's change since `since` from its balance
 * history. Accounts left out of net worth are listed separately.
 */
export async function netWorthAccounts(userId: string, since: LocalDate | null) {
  const [accounts, user, start] = await Promise.all([
    prisma.account.findMany({
      where: { userId, status: { not: "CLOSED" } },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        currentBalanceCents: true,
        includeInNetWorth: true,
        isHidden: true,
        isManual: true,
        institution: { select: { name: true } },
        connection: { select: { provider: true } },
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { currency: true } }),
    since ? balancesOn(userId, since) : Promise.resolve(new Map<string, number>()),
  ]);
  const rows: AccountBalanceInput[] = await Promise.all(
    accounts.map(async (a) => {
      const startRaw = start.get(a.id);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        group: netWorthGroup(a.type),
        side: isLiability(a.type) ? ("liability" as const) : ("asset" as const),
        balance: await convertToBase(userId, toCents(a.currentBalanceCents), a.currency, user.currency),
        startBalance: startRaw === undefined ? null : await convertToBase(userId, startRaw, a.currency, user.currency),
        included: a.includeInNetWorth,
        institution: a.institution?.name ?? null,
        isManual: a.isManual,
        isSimulated: a.connection?.provider === "MOCK",
        isHidden: a.isHidden,
      };
    }),
  );
  return accountContributions(rows);
}

/**
 * Everything the net-worth page shows for one history range: the summary, the daily
 * history (its last point is always today's live figures, so the chart ends at the
 * headline number), the change over the range, and each account's contribution and
 * change since the first day shown.
 */
export async function netWorthOverview(userId: string, range: NetWorthRange) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const today = todayIn(user.timeZone);
  const from = netWorthRangeStart(range, today);
  const [summary, stored] = await Promise.all([netWorthSummary(userId, today), netWorthHistory(userId, from ?? "1900-01-01", today)]);
  const history = stored.filter((p) => p.date < today);
  history.push({ date: today, assets: summary.assets, liabilities: summary.liabilities, netWorth: summary.netWorth });
  const first = history[0];
  const hasHistory = history.length > 1;
  const accounts = await netWorthAccounts(userId, hasHistory ? first.date : null);
  return {
    today,
    range,
    summary,
    history,
    change: hasHistory ? { from: first.date, amount: summary.netWorth - first.netWorth, assets: summary.assets - first.assets, liabilities: summary.liabilities - first.liabilities } : null,
    accounts,
  };
}

export type NetWorthOverview = Awaited<ReturnType<typeof netWorthOverview>>;
