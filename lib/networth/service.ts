import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, addMonths, fromDbDate, startOfMonth, startOfYear, toDbDate, type LocalDate } from "@/lib/dates";
import { calculateNetWorth, type NetWorthResult } from "@/lib/finance/calculations";
import { toCents } from "@/lib/finance/money";
import { convertToBase } from "@/lib/finance/fx";
import { isLiability, netWorthGroup } from "@/lib/accounts/types";

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
