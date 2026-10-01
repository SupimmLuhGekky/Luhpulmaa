import "server-only";
import type { LocalDate } from "@/lib/dates";
import type { WidgetId } from "@/lib/dashboard/layout";
import {
  loadAccountCount,
  loadBudget,
  loadCash,
  loadForecast,
  loadGoals,
  loadMonthAnalytics,
  loadNetWorth,
  loadRecentTransactions,
  loadSafeToSpend,
  loadSubscriptions,
  loadUpcomingBills,
} from "@/lib/dashboard/service";
import { CashFlowCard, InsightsCard, RecentTransactionsCard, SpendingBreakdownCard } from "./activity-cards";
import { CashCard, IncomeSpendingCard, NetWorthCard, SafeToSpendCard } from "./overview-cards";
import { BillsCard, BudgetCard, GoalsCard, SubscriptionsCard } from "./plan-cards";

interface WidgetProps {
  userId: string;
  today: LocalDate;
}

/**
 * Server half of each dashboard card: loads exactly the data the card shows and hands
 * plain, serialisable values to the client component.
 */
async function SafeToSpendWidget({ userId }: WidgetProps) {
  const [s, accounts] = await Promise.all([loadSafeToSpend(userId), loadAccountCount(userId)]);
  return (
    <SafeToSpendCard
      hasAccounts={accounts > 0}
      data={{ safeToSpend: s.safeToSpend, shortfall: s.shortfall, perDay: s.perDay, nextPayday: s.nextPayday, horizon: s.horizon, daysUntilPayday: s.daysUntilPayday, includesSavings: s.includesSavings, lines: s.lines }}
    />
  );
}

async function CashWidget({ userId }: WidgetProps) {
  const cash = await loadCash(userId);
  return <CashCard data={{ accounts: cash.accounts }} />;
}

async function NetWorthWidget({ userId, today }: WidgetProps) {
  const { summary, history } = await loadNetWorth(userId, today);
  return (
    <NetWorthCard
      data={{
        netWorth: summary.netWorth,
        assets: summary.assets,
        liabilities: summary.liabilities,
        changeThisMonth: summary.changeThisMonth,
        accountCount: summary.accountCount,
        history: history.map((h) => ({ date: h.date, netWorth: h.netWorth })),
      }}
    />
  );
}

async function IncomeSpendingWidget({ userId }: WidgetProps) {
  const a = await loadMonthAnalytics(userId);
  return (
    <IncomeSpendingCard
      data={{
        label: a.range.label,
        income: a.metrics.income,
        spending: a.metrics.spending,
        previousIncome: a.metrics.previous.income,
        previousSpending: a.metrics.previous.spending,
        savingsRateBps: a.metrics.savingsRateBps,
      }}
    />
  );
}

async function SpendingBreakdownWidget({ userId }: WidgetProps) {
  const a = await loadMonthAnalytics(userId);
  return (
    <SpendingBreakdownCard
      data={{
        label: a.range.label,
        total: a.metrics.spending,
        categories: a.categoryBreakdown.map((c) => ({ categoryId: c.categoryId || null, name: c.name, color: c.color, icon: c.icon, spending: c.spending, previous: c.previous, shareBps: c.shareBps })),
      }}
    />
  );
}

async function BudgetWidget({ userId, today }: WidgetProps) {
  const view = await loadBudget(userId, today);
  return (
    <BudgetCard
      data={
        view
          ? {
              name: view.budget.name,
              start: view.budget.start,
              end: view.budget.end,
              totals: { available: view.totals.available, spent: view.totals.spent, remaining: view.totals.remaining, unbudgetedSpent: view.totals.unbudgetedSpent },
              lines: view.lines.map((l) => ({ id: l.id, name: l.name, icon: l.icon, color: l.color, available: l.available, spent: l.spent, remaining: l.remaining, usedBps: l.usedBps, status: l.status })),
            }
          : null
      }
    />
  );
}

async function GoalsWidget({ userId, today }: WidgetProps) {
  const goals = await loadGoals(userId, today);
  return <GoalsCard goals={goals} />;
}

async function BillsWidget({ userId, today }: WidgetProps) {
  const bills = await loadUpcomingBills(userId, today);
  return (
    <BillsCard
      data={{
        nextPayday: bills.nextPayday,
        dueBeforePayday: bills.dueBeforePayday,
        countBeforePayday: bills.countBeforePayday,
        items: bills.items.map((b) => ({ billId: b.billId, name: b.name, dueDate: b.dueDate, amountCents: b.amountCents, isVariableAmount: b.isVariableAmount, autopay: b.autopay, category: b.category ? { icon: b.category.icon, color: b.category.color } : null })),
      }}
    />
  );
}

async function SubscriptionsWidget({ userId, today }: WidgetProps) {
  const subs = await loadSubscriptions(userId, today);
  const upcoming = subs.rows
    .filter((s) => s.status === "ACTIVE")
    .sort((a, b) => (a.nextChargeDate ?? "9999").localeCompare(b.nextChargeDate ?? "9999"))
    .slice(0, 4)
    .map((s) => ({ id: s.id, name: s.name, amountCents: s.amountCents, nextChargeDate: s.nextChargeDate, category: s.category ? { icon: s.category.icon, color: s.category.color } : null }));
  return <SubscriptionsCard data={{ totals: subs.totals, upcoming }} />;
}

async function CashFlowWidget({ userId }: WidgetProps) {
  const f = await loadForecast(userId);
  return (
    <CashFlowCard
      data={{
        startingBalance: f.startingBalance,
        endingBalance: f.endingBalance,
        lowestBalance: f.lowestBalance,
        lowestBalanceDate: f.lowestBalanceDate,
        minimumBuffer: f.minimumBuffer,
        belowBufferDays: f.belowBuffer.length,
        days: f.days.map((d) => ({ date: d.date, balance: d.balance })),
        upcoming: f.upcoming.slice(0, 5).map((e) => ({ date: e.date, amount: e.amount, label: e.label, kind: e.kind })),
      }}
    />
  );
}

async function RecentTransactionsWidget({ userId }: WidgetProps) {
  const rows = await loadRecentTransactions(userId);
  return (
    <RecentTransactionsCard
      rows={rows.map((t) => ({
        id: t.id,
        date: t.date,
        merchantName: t.merchantName,
        amountCents: t.amountCents,
        isPending: t.isPending,
        isTransfer: t.isTransfer,
        account: t.account ? { name: t.account.name } : null,
        category: t.category ? { name: t.category.name, icon: t.category.icon, color: t.category.color } : null,
      }))}
    />
  );
}

async function InsightsWidget({ userId }: WidgetProps) {
  const a = await loadMonthAnalytics(userId);
  return <InsightsCard items={a.insights.map((i) => ({ id: i.id, tone: i.tone, text: i.text, basis: i.basis }))} />;
}

export const WIDGETS: Record<WidgetId, (props: WidgetProps) => Promise<React.JSX.Element>> = {
  safeToSpend: SafeToSpendWidget,
  cash: CashWidget,
  netWorth: NetWorthWidget,
  incomeSpending: IncomeSpendingWidget,
  spendingBreakdown: SpendingBreakdownWidget,
  budget: BudgetWidget,
  goals: GoalsWidget,
  bills: BillsWidget,
  subscriptions: SubscriptionsWidget,
  cashFlow: CashFlowWidget,
  recentTransactions: RecentTransactionsWidget,
  insights: InsightsWidget,
};

/** Wider cards on large screens. */
export const WIDGET_SPAN: Partial<Record<WidgetId, string>> = {
  cashFlow: "md:col-span-2",
  recentTransactions: "md:col-span-2 xl:col-span-1",
  insights: "md:col-span-2 xl:col-span-3",
};

/** Cards that load charts get a taller skeleton. */
export const TALL_WIDGETS = new Set<WidgetId>(["cashFlow", "spendingBreakdown", "netWorth", "recentTransactions"]);

/**
 * Phone order when the user hasn't customised the layout:
 * safe to spend, cash, spending, goals, bills, then everything else.
 */
export const MOBILE_ORDER: Partial<Record<WidgetId, string>> = {
  safeToSpend: "order-1",
  cash: "order-2",
  incomeSpending: "order-3",
  goals: "order-4",
  bills: "order-5",
};
