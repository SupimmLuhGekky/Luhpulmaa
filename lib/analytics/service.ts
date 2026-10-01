import "server-only";
import { prisma } from "@/lib/db/prisma";
import { addMonths, daysBetween, startOfMonth, todayIn } from "@/lib/dates";
import { calculateSavingsRate } from "@/lib/finance/calculations";
import { mulDiv, ratioBps, type Cents } from "@/lib/finance/money";
import { monthlyEquivalent } from "@/lib/finance/frequency";
import { netWorthHistory, netWorthSummary } from "@/lib/networth/service";
import { firstTransactionDate, incomeSpendingSeries, spendingByCategory, spendingByMerchant, totalIncome, totalSpending, type TxnScope } from "./aggregates";
import { generateInsights } from "./insights";
import { analyticsQuerySchema, averageMonthlySpending, bucketFor, comparisonCoverage, fillSeries, resolveRange, type AnalyticsQuery } from "./range";

export { analyticsQuerySchema, resolveRange, type AnalyticsQuery };

export async function analytics(userId: string, q: AnalyticsQuery) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true, weekStartsOn: true } });
  const today = todayIn(user.timeZone);
  const range = resolveRange(q, today, user.weekStartsOn);
  const days = daysBetween(range.from, range.to) + 1;
  const scope: TxnScope = { accountIds: q.accounts, categoryIds: q.categories };
  const scoped = Boolean(q.accounts?.length || q.categories?.length);

  const [income, spending, prevIncome, prevSpending, byCat, prevByCat, merchants, categories, subs, since] = await Promise.all([
    totalIncome(userId, range.from, range.to, scope),
    totalSpending(userId, range.from, range.to, scope),
    totalIncome(userId, range.previousFrom, range.previousTo, scope),
    totalSpending(userId, range.previousFrom, range.previousTo, scope),
    spendingByCategory(userId, range.from, range.to, scope),
    spendingByCategory(userId, range.previousFrom, range.previousTo, scope),
    spendingByMerchant(userId, range.from, range.to, 10, scope),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true, color: true, icon: true } }),
    prisma.subscription.findMany({ where: { userId, status: "ACTIVE" }, select: { amountCents: true, frequency: true } }),
    firstTransactionDate(userId, scope),
  ]);
  const trendFrom = addMonths(startOfMonth(today), -11);
  // With no transactions in the comparison period, a "change" would only say the data is new.
  const comparison = comparisonCoverage(range, since);
  // Averages only count days the history covers: an account connected mid-period has no data before.
  const coveredFrom = since && since > range.from ? since : range.from;
  const coveredDays = Math.max(1, daysBetween(coveredFrom, range.to) + 1);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const describe = (id: string | null) => ({
    categoryId: id,
    name: id ? (catMap.get(id)?.name ?? "Unknown") : "Uncategorized",
    color: id ? (catMap.get(id)?.color ?? "#94a3b8") : "#94a3b8",
    icon: id ? (catMap.get(id)?.icon ?? "circle") : "circle-dashed",
  });
  const categoryBreakdown = [...byCat.entries()]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({
      ...describe(id),
      spending: v,
      previous: Math.max(0, prevByCat.get(id) ?? 0),
      shareBps: ratioBps(v, spending),
    }))
    .sort((a, b) => b.spending - a.spending);
  // Changes vs the previous period over categories present in EITHER period, so a
  // category that dropped to zero still shows up.
  const categoryChanges = (comparison === "none" ? [] : [...new Set([...byCat.keys(), ...prevByCat.keys()])])
    .map((id) => {
      const current = Math.max(0, byCat.get(id) ?? 0);
      const previous = Math.max(0, prevByCat.get(id) ?? 0);
      return { ...describe(id), spending: current, previous, delta: current - previous };
    })
    .filter((c) => c.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name));

  const bucket = bucketFor(days);
  const [rawSeries, rawMonthly, recurringRows] = await Promise.all([
    incomeSpendingSeries(userId, range.from, range.to, bucket, scope),
    incomeSpendingSeries(userId, trendFrom, today, "month", scope),
    prisma.recurringTransaction.findMany({ where: { userId, status: { not: "DISMISSED" }, direction: "OUTFLOW" }, select: { averageAmountCents: true, frequency: true } }),
  ]);
  const series = fillSeries(rawSeries, range.from, range.to, bucket);
  const monthly = fillSeries(rawMonthly, trendFrom, today, "month");
  const recurringMonthly = recurringRows.reduce((a, r) => a + monthlyEquivalent(-Number(r.averageAmountCents), r.frequency), 0);
  const subscriptionsMonthly = subs.reduce((a, s) => a + monthlyEquivalent(Number(s.amountCents), s.frequency), 0);
  const nwHistory = await netWorthHistory(userId, addMonths(today, -12), today);
  const nw = await netWorthSummary(userId, today);

  const metrics = {
    income,
    spending,
    savings: income - spending,
    savingsRateBps: calculateSavingsRate(income, spending),
    averageDailySpending: mulDiv(spending, 1, coveredDays),
    averageMonthlySpending: averageMonthlySpending(monthly, since, today),
    biggestCategory: categoryBreakdown[0] ?? null,
    biggestMerchant: merchants[0] ?? null,
    recurringMonthly,
    subscriptionsMonthly,
    netWorth: nw.netWorth,
    previous: { income: prevIncome, spending: prevSpending },
  };
  const insights = await generateInsights(userId, { range, metrics, categoryBreakdown, categoryChanges, today, scoped, comparable: comparison !== "none", coveredFrom });

  // Goal savings progress over time (cumulative contributions by month).
  const goalRows = await prisma.$queryRaw<{ month: Date; total: bigint }[]>`
    SELECT date_trunc('month', "date")::date AS month, SUM("amountCents")::bigint AS total
    FROM "goal_contributions" WHERE "userId" = ${userId}::uuid GROUP BY 1 ORDER BY 1`;
  let running = 0;
  const savingsProgress = goalRows.map((r) => {
    running += Number(r.total);
    return { month: r.month.toISOString().slice(0, 7), total: running };
  });

  return {
    /**
     * `comparison`: how much of the previous period has data; `dataSince`: first transaction
     * in scope; `coveredFrom`/`coveredDays`: the part of the range the history covers (averages use it).
     */
    range: { ...range, days, bucket, comparison, dataSince: since, coveredFrom, coveredDays },
    filters: { accounts: q.accounts ?? [], categories: q.categories ?? [], scoped },
    metrics,
    categoryBreakdown,
    categoryChanges,
    merchants,
    series,
    monthly,
    netWorth: nwHistory,
    savingsProgress,
    insights,
  };
}

export type Analytics = Awaited<ReturnType<typeof analytics>>;
export type { Cents };
