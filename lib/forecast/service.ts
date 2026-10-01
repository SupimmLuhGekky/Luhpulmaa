import "server-only";
import { prisma } from "@/lib/db/prisma";
import { addDays, daysBetween, fromDbDate, monthKey, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { nextOccurrence, occurrencesBetween } from "@/lib/dates/schedule";
import { calculateCashFlow, calculateSafeToSpend, type CashFlowEvent } from "@/lib/finance/calculations";
import { mulDiv, toCents, type Cents } from "@/lib/finance/money";
import { cashTotals } from "@/lib/accounts/service";
import { billOccurrences } from "@/lib/bills/service";
import { budgetView, findBudget } from "@/lib/budget/service";
import { expectedPaydays } from "@/lib/income/service";
import { userPreferences } from "@/lib/settings/preferences";
import { ESSENTIAL_CATEGORY_KEYS } from "@/lib/categories/defaults";
import { totalSpending } from "@/lib/analytics/aggregates";

/**
 * Safe-to-spend: how much can be spent before the next payday without missing a
 * bill, dipping into budgeted essentials, skipping planned savings, or going below
 * the user's minimum cash buffer. Every input line is returned so the UI can explain
 * exactly how the number was produced.
 */
export async function safeToSpend(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true, minCashBufferCents: true } });
  const today = todayIn(user.timeZone);
  const prefs = await userPreferences(userId);
  const cash = await cashTotals(userId, prefs.includeSavingsInSafeToSpend);

  const paydays = await expectedPaydays(userId, addDays(today, 1), addDays(today, 45));
  const nextPayday = paydays[0]?.date ?? null;
  // Without a known payday we look 14 days ahead.
  const horizon = nextPayday ?? addDays(today, 14);
  const horizonEnd = addDays(horizon, -1) < today ? today : addDays(horizon, -1);

  // Bills and subscriptions due before the next payday (unpaid only).
  const bills = (await billOccurrences(userId, today, horizonEnd)).filter((b) => !b.paid);
  const subs = await prisma.subscription.findMany({ where: { userId, status: "ACTIVE", nextChargeDate: { not: null } }, select: { id: true, name: true, amountCents: true, frequency: true, nextChargeDate: true, recurringId: true } });
  const billRecurring = new Set((await prisma.bill.findMany({ where: { userId, recurringId: { not: null } }, select: { recurringId: true } })).map((b) => b.recurringId));
  const subItems: { name: string; date: LocalDate; amount: Cents }[] = [];
  for (const s of subs) {
    if (s.recurringId && billRecurring.has(s.recurringId)) continue;
    for (const d of occurrencesBetween(fromDbDate(s.nextChargeDate)!, s.frequency, today, horizonEnd)) subItems.push({ name: s.name, date: d, amount: toCents(s.amountCents) });
  }
  const upcomingBills = bills.reduce((a, b) => a + b.amountCents, 0) + subItems.reduce((a, s) => a + s.amount, 0);

  // Reserved budget: the unspent part of essential budget lines, pro-rated to the days until payday.
  let reservedBudget = 0;
  const reservedLines: { name: string; amount: Cents }[] = [];
  const budget = await findBudget(userId, "MONTHLY", `${monthKey(today)}-01`);
  if (budget) {
    const view = await budgetView(userId, budget.id);
    const categories = await prisma.category.findMany({ where: { userId }, select: { id: true, systemKey: true } });
    const essential = new Set(categories.filter((c) => c.systemKey && ESSENTIAL_CATEGORY_KEYS.has(c.systemKey)).map((c) => c.id));
    const billCategories = new Set(bills.map((b) => b.category?.id).filter(Boolean));
    const daysLeftInMonth = daysBetween(today, view.budget.end) + 1;
    const daysUntilPayday = Math.max(1, Math.min(daysLeftInMonth, daysBetween(today, horizon)));
    for (const line of view.lines) {
      if (!line.categoryId || !essential.has(line.categoryId) || billCategories.has(line.categoryId) || line.remaining <= 0) continue;
      const amount = mulDiv(line.remaining, daysUntilPayday, daysLeftInMonth);
      if (amount > 0) {
        reservedBudget += amount;
        reservedLines.push({ name: line.name, amount });
      }
    }
  }

  // Planned savings: fixed scheduled goal automations due before payday.
  const automations = await prisma.automation.findMany({ where: { userId, isActive: true, trigger: { in: ["SCHEDULE_MONTHLY", "SCHEDULE_WEEKLY"] } }, include: { actions: true } });
  let plannedSavings = 0;
  for (const a of automations) {
    const cfg = a.triggerConfig as { dayOfMonth?: number; dayOfWeek?: number };
    const amount = a.actions.filter((x) => x.type === "ALLOCATE_TO_GOAL").reduce((acc, x) => acc + ((x.config as { amountCents?: number }).amountCents ?? 0), 0);
    if (!amount) continue;
    for (let d = today; d <= horizonEnd; d = addDays(d, 1)) {
      const dom = Number(d.slice(8, 10));
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if ((a.trigger === "SCHEDULE_MONTHLY" && cfg.dayOfMonth === dom) || (a.trigger === "SCHEDULE_WEEKLY" && cfg.dayOfWeek === dow)) plannedSavings += amount;
    }
  }

  const result = calculateSafeToSpend({ availableCash: cash.available, upcomingBills, reservedBudget, plannedSavings, minimumBuffer: toCents(user.minCashBufferCents) });
  const daysUntilPayday = Math.max(1, daysBetween(today, horizon));
  return {
    ...result,
    perDay: Math.floor(result.safeToSpend / daysUntilPayday),
    today,
    nextPayday,
    horizon,
    daysUntilPayday,
    includesSavings: prefs.includeSavingsInSafeToSpend,
    details: {
      bills: [...bills.map((b) => ({ name: b.name, date: b.dueDate, amount: b.amountCents })), ...subItems].sort((a, b) => (a.date < b.date ? -1 : 1)),
      reserved: reservedLines,
      accounts: cash.accounts.filter((a) => a.type !== "SAVINGS" || prefs.includeSavingsInSafeToSpend),
    },
  };
}

export type SafeToSpend = Awaited<ReturnType<typeof safeToSpend>>;

/**
 * Cash-flow forecast (ESTIMATE). Starts from current spendable cash and projects:
 * expected paycheques, bills, subscriptions, scheduled goal allocations and typical
 * day-to-day spending (average of the last 90 days of non-recurring spending).
 */
export async function cashFlowForecast(userId: string, days: 7 | 30 | 60 | 90) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true, minCashBufferCents: true } });
  const today = todayIn(user.timeZone);
  const end = addDays(today, days - 1);
  const prefs = await userPreferences(userId);
  const cash = await cashTotals(userId, prefs.includeSavingsInSafeToSpend);
  const events: CashFlowEvent[] = [];

  for (const p of await expectedPaydays(userId, addDays(today, 1), end)) events.push({ date: p.date, amount: p.amount, kind: "income", label: p.name });
  const billRows = (await billOccurrences(userId, today, end)).filter((b) => !b.paid);
  for (const b of billRows) events.push({ date: b.dueDate, amount: -b.amountCents, kind: "bill", label: b.name });
  const billRecurring = new Set((await prisma.bill.findMany({ where: { userId, recurringId: { not: null } }, select: { recurringId: true } })).map((b) => b.recurringId));
  const subs = await prisma.subscription.findMany({ where: { userId, status: "ACTIVE", nextChargeDate: { not: null } } });
  for (const s of subs) {
    if (s.recurringId && billRecurring.has(s.recurringId)) continue;
    const first = nextOccurrence(fromDbDate(s.nextChargeDate)!, s.frequency, today) ?? fromDbDate(s.nextChargeDate)!;
    for (const d of occurrencesBetween(first, s.frequency, today, end)) events.push({ date: d, amount: -toCents(s.amountCents), kind: "subscription", label: s.name });
  }
  const automations = await prisma.automation.findMany({ where: { userId, isActive: true, trigger: { in: ["SCHEDULE_MONTHLY", "SCHEDULE_WEEKLY"] } }, include: { actions: true } });
  for (const a of automations) {
    const cfg = a.triggerConfig as { dayOfMonth?: number; dayOfWeek?: number };
    const amount = a.actions.filter((x) => x.type === "ALLOCATE_TO_GOAL").reduce((acc, x) => acc + ((x.config as { amountCents?: number }).amountCents ?? 0), 0);
    if (!amount) continue;
    for (let d = today; d <= end; d = addDays(d, 1)) {
      const dom = Number(d.slice(8, 10));
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if ((a.trigger === "SCHEDULE_MONTHLY" && cfg.dayOfMonth === dom) || (a.trigger === "SCHEDULE_WEEKLY" && cfg.dayOfWeek === dow)) {
        events.push({ date: d, amount: -amount, kind: "goal", label: `${a.name} (planned)` });
      }
    }
  }

  // Typical daily discretionary spending = last 90 days of spending minus recurring, / 90.
  const since = addDays(today, -90);
  const spent90 = await totalSpending(userId, since, addDays(today, -1));
  const recurring90 = await prisma.transaction.aggregate({ where: { userId, date: { gte: toDbDate(since), lt: toDbDate(today) }, isRecurring: true, isTransfer: false, type: "EXPENSE" }, _sum: { amountCents: true } });
  const discretionary = Math.max(0, spent90 + toCents(recurring90._sum.amountCents));
  const dailyDiscretionary = mulDiv(discretionary, 1, 90);

  const flow = calculateCashFlow(cash.available, events, today, days, dailyDiscretionary);
  return {
    ...flow,
    today,
    horizonDays: days,
    dailyDiscretionary,
    minimumBuffer: toCents(user.minCashBufferCents),
    belowBuffer: flow.days.filter((d) => d.balance < toCents(user.minCashBufferCents)).map((d) => d.date),
    upcoming: events.sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}
