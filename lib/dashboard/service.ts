import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDbDate, startOfMonth, type LocalDate } from "@/lib/dates";
import { calculateGoalProgress } from "@/lib/finance/calculations";
import { toCents } from "@/lib/finance/money";
import { cashTotals } from "@/lib/accounts/service";
import { analytics } from "@/lib/analytics/service";
import { billOccurrences } from "@/lib/bills/service";
import { budgetView, findBudget } from "@/lib/budget/service";
import { cashFlowForecast, safeToSpend } from "@/lib/forecast/service";
import { listGoals } from "@/lib/goals/service";
import { expectedPaydays } from "@/lib/income/service";
import { netWorthHistory, netWorthSummary } from "@/lib/networth/service";
import { listSubscriptions } from "@/lib/subscriptions/service";
import { listTransactions } from "@/lib/transactions/service";
import { transactionFiltersSchema } from "@/lib/transactions/schemas";
import { resolveLayout, type DashboardLayout } from "./layout";

/**
 * Dashboard data loaders. Each widget loads its own data inside a Suspense boundary
 * so the page streams; `cache()` makes widgets that share a source (safe-to-spend,
 * this month's analytics…) hit the database once per request.
 */
export const loadLayout = cache(async (userId: string): Promise<{ layout: DashboardLayout; customized: boolean }> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dashboardLayout: true } });
  return { layout: resolveLayout(user.dashboardLayout), customized: user.dashboardLayout !== null };
});

/** Saves the widget order/visibility; `null` resets to the default layout. */
export async function saveLayout(userId: string, layout: DashboardLayout | null) {
  await prisma.user.update({ where: { id: userId }, data: { dashboardLayout: layout ?? Prisma.DbNull } });
}

export const loadSafeToSpend = cache((userId: string) => safeToSpend(userId));

export const loadMonthAnalytics = cache((userId: string) => analytics(userId, { range: "month" }));

export const loadCash = cache((userId: string) => cashTotals(userId, true));

export const loadNetWorth = cache(async (userId: string, today: LocalDate) => {
  const [summary, history] = await Promise.all([netWorthSummary(userId, today), netWorthHistory(userId, addDays(today, -89), today)]);
  return { summary, history };
});

export const loadBudget = cache(async (userId: string, today: LocalDate) => {
  const budget = await findBudget(userId, "MONTHLY", startOfMonth(today));
  return budget ? budgetView(userId, budget.id) : null;
});

export const loadGoals = cache(async (userId: string, today: LocalDate) => {
  const goals = await listGoals(userId);
  return goals
    .filter((g) => g.status === "ACTIVE")
    .map((g) => {
      const progress = calculateGoalProgress(toCents(g.targetCents), toCents(g.currentCents), fromDbDate(g.deadline), today);
      return { id: g.id, name: g.name, icon: g.icon, color: g.color, priority: g.priority, deadline: fromDbDate(g.deadline), ...progress };
    });
});

export const loadUpcomingBills = cache(async (userId: string, today: LocalDate) => {
  const [occurrences, paydays] = await Promise.all([billOccurrences(userId, today, addDays(today, 30)), expectedPaydays(userId, addDays(today, 1), addDays(today, 45))]);
  const nextPayday = paydays[0]?.date ?? null;
  const unpaid = occurrences.filter((o) => !o.paid);
  const beforePayday = nextPayday ? unpaid.filter((o) => o.dueDate < nextPayday) : [];
  return { items: unpaid.slice(0, 6), nextPayday, dueBeforePayday: beforePayday.reduce((a, o) => a + o.amountCents, 0), countBeforePayday: beforePayday.length };
});

export const loadSubscriptions = cache((userId: string, today: LocalDate) => listSubscriptions(userId, today));

export const loadForecast = cache((userId: string) => cashFlowForecast(userId, 30));

export const loadRecentTransactions = cache((userId: string) => listTransactions(userId, transactionFiltersSchema.parse({ pageSize: 10 })).then((r) => r.rows.slice(0, 6)));

export const loadAccountCount = cache((userId: string) => prisma.account.count({ where: { userId, status: { not: "CLOSED" } } }));
