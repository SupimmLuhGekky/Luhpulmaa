import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { addDays, addMonths, daysBetween, endOfMonth, startOfMonth, startOfQuarter, startOfWeek, startOfYear, todayIn, type LocalDate } from "@/lib/dates";
import { averageCents, calculateSavingsRate } from "@/lib/finance/calculations";
import { mulDiv, ratioBps, type Cents } from "@/lib/finance/money";
import { monthlyEquivalent } from "@/lib/finance/frequency";
import { netWorthHistory, netWorthSummary } from "@/lib/networth/service";
import { incomeSpendingSeries, spendingByCategory, spendingByMerchant, totalIncome, totalSpending } from "./aggregates";
import { generateInsights } from "./insights";

export const analyticsQuerySchema = z.object({
  range: z.enum(["week", "month", "quarter", "year", "custom"]).default("month"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export function resolveRange(q: AnalyticsQuery, today: LocalDate, weekStartsOn = 0): { from: LocalDate; to: LocalDate; previousFrom: LocalDate; previousTo: LocalDate; label: string } {
  let from: LocalDate;
  let to: LocalDate = today;
  switch (q.range) {
    case "week":
      from = startOfWeek(today, weekStartsOn);
      break;
    case "quarter":
      from = startOfQuarter(today);
      break;
    case "year":
      from = startOfYear(today);
      break;
    case "custom":
      from = q.from ?? addDays(today, -29);
      to = q.to && q.to >= from ? q.to : today;
      break;
    default:
      from = startOfMonth(today);
  }
  const len = daysBetween(from, to) + 1;
  let previousFrom = addDays(from, -len);
  let previousTo = addDays(from, -1);
  if (q.range === "month") {
    previousFrom = addMonths(from, -1);
    previousTo = addMonths(to, -1) > endOfMonth(previousFrom) ? endOfMonth(previousFrom) : addMonths(to, -1);
  }
  const labels = { week: "This week", month: "This month", quarter: "This quarter", year: "This year", custom: "Custom range" } as const;
  return { from, to, previousFrom, previousTo, label: labels[q.range] };
}

export async function analytics(userId: string, q: AnalyticsQuery) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true, weekStartsOn: true } });
  const today = todayIn(user.timeZone);
  const range = resolveRange(q, today, user.weekStartsOn);
  const days = daysBetween(range.from, range.to) + 1;

  const [income, spending, prevIncome, prevSpending, byCat, prevByCat, merchants, categories, subs, trendFrom] = await Promise.all([
    totalIncome(userId, range.from, range.to),
    totalSpending(userId, range.from, range.to),
    totalIncome(userId, range.previousFrom, range.previousTo),
    totalSpending(userId, range.previousFrom, range.previousTo),
    spendingByCategory(userId, range.from, range.to),
    spendingByCategory(userId, range.previousFrom, range.previousTo),
    spendingByMerchant(userId, range.from, range.to, 10),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true, color: true, icon: true } }),
    prisma.subscription.findMany({ where: { userId, status: "ACTIVE" }, select: { amountCents: true, frequency: true } }),
    Promise.resolve(addMonths(startOfMonth(today), -11)),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const categoryBreakdown = [...byCat.entries()]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({
      categoryId: id,
      name: id ? (catMap.get(id)?.name ?? "Unknown") : "Uncategorized",
      color: id ? (catMap.get(id)?.color ?? "#94a3b8") : "#94a3b8",
      icon: id ? (catMap.get(id)?.icon ?? "circle") : "circle-dashed",
      spending: v,
      previous: Math.max(0, prevByCat.get(id) ?? 0),
      shareBps: ratioBps(v, spending),
    }))
    .sort((a, b) => b.spending - a.spending);

  const bucket = days <= 31 ? "day" : days <= 120 ? "week" : "month";
  const [series, monthly, recurringRows] = await Promise.all([
    incomeSpendingSeries(userId, range.from, range.to, bucket),
    incomeSpendingSeries(userId, trendFrom, today, "month"),
    prisma.recurringTransaction.findMany({ where: { userId, status: { not: "DISMISSED" }, direction: "OUTFLOW" }, select: { averageAmountCents: true, frequency: true } }),
  ]);
  const recurringMonthly = recurringRows.reduce((a, r) => a + monthlyEquivalent(-Number(r.averageAmountCents), r.frequency), 0);
  const subscriptionsMonthly = subs.reduce((a, s) => a + monthlyEquivalent(Number(s.amountCents), s.frequency), 0);
  const completeMonths = monthly.filter((m) => m.period < today.slice(0, 7));
  const nwHistory = await netWorthHistory(userId, addMonths(today, -12), today);
  const nw = await netWorthSummary(userId, today);

  const metrics = {
    income,
    spending,
    savings: income - spending,
    savingsRateBps: calculateSavingsRate(income, spending),
    averageDailySpending: mulDiv(spending, 1, days),
    averageMonthlySpending: averageCents(completeMonths.slice(-6).map((m) => m.spending)),
    biggestCategory: categoryBreakdown[0] ?? null,
    biggestMerchant: merchants[0] ?? null,
    recurringMonthly,
    subscriptionsMonthly,
    netWorth: nw.netWorth,
    previous: { income: prevIncome, spending: prevSpending },
  };
  const insights = await generateInsights(userId, { range, metrics, categoryBreakdown, today });

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
    range: { ...range, days, bucket },
    metrics,
    categoryBreakdown,
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
