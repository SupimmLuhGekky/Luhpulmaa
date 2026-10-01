import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, addMonths, fromDbDate, startOfMonth, startOfYear, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { calculateNetWorth, type NetWorthResult } from "@/lib/finance/calculations";
import { toCents } from "@/lib/finance/money";
import { convertToBase } from "@/lib/finance/fx";
import { isLiability, netWorthGroup } from "@/lib/accounts/types";
import { accountContributions, netWorthRangeStart, rebuildNetWorthHistory, type AccountBalanceInput, type BalancePoint, type NetWorthRange } from "./contributions";

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

/**
 * Converts many amounts with one rate lookup per currency, with the same exact
 * arithmetic and rounding as convertToBase (the rate is read back as rate × 10^8).
 */
async function baseConverter(userId: string, currencies: string[], base: string) {
  const SCALE = 100_000_000n;
  const factors = new Map<string, bigint>();
  await Promise.all([...new Set(currencies)].map(async (c) => factors.set(c, BigInt(await convertToBase(userId, Number(SCALE), c, base)))));
  return (amount: number, currency: string): number => {
    const factor = factors.get(currency) ?? SCALE;
    if (factor === SCALE) return amount;
    const product = BigInt(amount) * factor;
    const q = product / SCALE;
    const r = product % SCALE;
    const abs = r < 0n ? -r : r;
    return Number(abs * 2n >= SCALE ? (product < 0n ? q - 1n : q + 1n) : q);
  };
}

/**
 * Daily net worth for [from, to], rebuilt from the balance history of the accounts
 * that count toward net worth now (see rebuildNetWorthHistory), so it always agrees
 * with today's figure and with the per-account breakdown, also after an account is
 * left out of net worth. Also returns each account's balance on the first day.
 */
async function includedHistory(userId: string, from: LocalDate, to: LocalDate) {
  const [accounts, user] = await Promise.all([
    prisma.account.findMany({ where: { userId, includeInNetWorth: true }, select: { id: true, type: true, currency: true, status: true, currentBalanceCents: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { currency: true, timeZone: true } }),
  ]);
  if (!accounts.length) return rebuildNetWorthHistory([], [], from, to);
  const ids = accounts.map((a) => a.id);
  const [seed, inRange, convert] = await Promise.all([
    // Each account's latest balance before the range seeds the first day.
    prisma.$queryRaw<{ accountId: string; date: Date; balanceCents: bigint }[]>`
      SELECT DISTINCT ON ("accountId") "accountId", "date", "balanceCents"
      FROM "account_balance_snapshots"
      WHERE "userId" = ${userId}::uuid AND "accountId" = ANY(${ids}::uuid[]) AND "date" < ${toDbDate(from)}
      ORDER BY "accountId", "date" DESC`,
    prisma.accountBalanceSnapshot.findMany({ where: { userId, accountId: { in: ids }, date: { gte: toDbDate(from), lte: toDbDate(to) } }, select: { accountId: true, date: true, balanceCents: true } }),
    baseConverter(
      userId,
      accounts.map((a) => a.currency),
      user.currency,
    ),
  ]);
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const points: BalancePoint[] = [...seed, ...inRange].map((r) => ({ accountId: r.accountId, date: fromDbDate(r.date), balance: convert(toCents(r.balanceCents), currencyOf.get(r.accountId)!) }));
  // Today's balance closes each open account's series; an account without any recorded
  // balance yet counts at today's balance (like the history backfill does).
  const today = todayIn(user.timeZone);
  for (const a of accounts) {
    if (a.status !== "CLOSED") points.push({ accountId: a.id, date: today, balance: convert(toCents(a.currentBalanceCents), a.currency) });
  }
  return rebuildNetWorthHistory(
    accounts.map((a) => ({ id: a.id, side: isLiability(a.type) ? "liability" : "asset", closed: a.status === "CLOSED" })),
    points,
    from,
    to,
  );
}

export async function netWorthHistory(userId: string, from: LocalDate, to: LocalDate) {
  return (await includedHistory(userId, from, to)).history;
}

/** Net worth on `date` (null when there is no balance history by then). */
async function netWorthAt(userId: string, date: LocalDate): Promise<number | null> {
  const { history } = await includedHistory(userId, date, date);
  return history.length ? history[0].netWorth : null;
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

/**
 * Per-account contribution to net worth (same accounts and conversion as
 * currentNetWorth), with each account's change from its balance at the start of the
 * history shown (`start`, already in the user's currency; null without history).
 * Accounts left out of net worth are listed separately.
 */
export async function netWorthAccounts(userId: string, start: Map<string, number> | null) {
  const [accounts, user] = await Promise.all([
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
  ]);
  const rows: AccountBalanceInput[] = await Promise.all(
    accounts.map(async (a) => {
      const startBalance = start?.get(a.id);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        group: netWorthGroup(a.type),
        side: isLiability(a.type) ? ("liability" as const) : ("asset" as const),
        balance: await convertToBase(userId, toCents(a.currentBalanceCents), a.currency, user.currency),
        startBalance: startBalance === undefined ? null : startBalance,
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
  const [summary, rebuilt] = await Promise.all([netWorthSummary(userId, today), includedHistory(userId, from ?? "1900-01-01", today)]);
  const history = rebuilt.history.filter((p) => p.date < today);
  history.push({ date: today, assets: summary.assets, liabilities: summary.liabilities, netWorth: summary.netWorth });
  const first = history[0];
  const hasHistory = history.length > 1;
  const accounts = await netWorthAccounts(userId, hasHistory ? rebuilt.startBalances : null);
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
