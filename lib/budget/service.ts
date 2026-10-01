import "server-only";
import type { Budget, BudgetItem, BudgetPeriod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { addDays, addMonthKey, endOfWeek, fromDbDate, monthKey, monthRange, startOfWeek, toDbDate, type LocalDate, type MonthKey } from "@/lib/dates";
import { calculateBudgetRemaining, calculateRollover, calculateZeroBased, resolveBudgetAmount } from "@/lib/finance/calculations";
import { formatCurrency, toCents, type Cents } from "@/lib/finance/money";
import { spendingByCategory, spendingByCategoryPerMonth, totalIncome, totalSpending } from "@/lib/analytics/aggregates";
import { runBudgetThresholdAutomations } from "@/lib/automation/engine";
import { notify } from "@/lib/notifications/service";
import { userPreferences } from "@/lib/settings/preferences";
import { crossedThreshold } from "./thresholds";

export const budgetItemInputSchema = z.object({
  categoryId: z.string().uuid().nullable(),
  label: z.string().trim().max(60).nullable().optional(),
  amountType: z.enum(["FIXED", "PERCENT_OF_INCOME"]).default("FIXED"),
  amountCents: z.number().int().min(0).max(100_000_000).default(0),
  percentBps: z.number().int().min(0).max(10000).nullable().optional(),
  rolloverEnabled: z.boolean().default(false),
  alertThresholds: z.array(z.number().int().min(1).max(200)).max(6).default([80, 100]),
});

export const budgetSettingsSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  mode: z.enum(["STANDARD", "ZERO_BASED"]).optional(),
  plannedIncomeCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const createBudgetSchema = z.object({
  period: z.enum(["MONTHLY", "WEEKLY", "CUSTOM"]),
  /** MONTHLY: any date in the month. WEEKLY: any date in the week. CUSTOM: start date. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  name: z.string().trim().min(1).max(60).optional(),
  copyFromPrevious: z.boolean().default(true),
  mode: z.enum(["STANDARD", "ZERO_BASED"]).optional(),
  plannedIncomeCents: z.number().int().min(0).nullable().optional(),
});

function periodBounds(period: BudgetPeriod, start: LocalDate, end?: LocalDate, weekStartsOn = 0) {
  if (period === "MONTHLY") return monthRange(monthKey(start));
  if (period === "WEEKLY") return { start: startOfWeek(start, weekStartsOn), end: endOfWeek(start, weekStartsOn) };
  if (!end || end < start) throw new AppError("VALIDATION_FAILED", "Custom budgets need an end date after the start date.");
  return { start, end };
}

export async function listBudgets(userId: string) {
  const budgets = await prisma.budget.findMany({
    where: { userId },
    orderBy: [{ startDate: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, period: true, startDate: true, endDate: true, mode: true, plannedIncomeCents: true, _count: { select: { items: true } } },
  });
  return budgets.map(({ _count, ...b }) => ({
    ...b,
    startDate: fromDbDate(b.startDate),
    endDate: fromDbDate(b.endDate),
    plannedIncomeCents: b.plannedIncomeCents === null ? null : toCents(b.plannedIncomeCents),
    lineCount: _count.items,
  }));
}

export type BudgetSummary = Awaited<ReturnType<typeof listBudgets>>[number];

export async function findBudget(userId: string, period: BudgetPeriod, startDate: LocalDate) {
  return prisma.budget.findFirst({ where: { userId, period, startDate: toDbDate(startDate) }, orderBy: { createdAt: "asc" } });
}

export async function createBudget(userId: string, input: z.infer<typeof createBudgetSchema>) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { budgetMode: true, weekStartsOn: true, monthlyIncomeTargetCents: true } });
  const { start, end } = periodBounds(input.period, input.startDate, input.endDate, user.weekStartsOn);
  const name = input.name ?? (input.period === "MONTHLY" ? "Monthly budget" : input.period === "WEEKLY" ? "Weekly budget" : "Custom budget");
  // One monthly or weekly budget per period; custom budgets are told apart by name.
  const existing = await prisma.budget.findFirst({
    where: { userId, period: input.period, startDate: toDbDate(start), ...(input.period === "CUSTOM" ? { name } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  let source: (Budget & { items: BudgetItem[] }) | null = null;
  if (input.copyFromPrevious) {
    source = await prisma.budget.findFirst({ where: { userId, period: input.period, startDate: { lt: toDbDate(start) } }, orderBy: { startDate: "desc" }, include: { items: true } });
  }
  const budget = await prisma.budget.create({
    data: {
      userId,
      name,
      period: input.period,
      startDate: toDbDate(start),
      endDate: toDbDate(end),
      mode: input.mode ?? source?.mode ?? user.budgetMode,
      plannedIncomeCents: input.plannedIncomeCents ?? source?.plannedIncomeCents ?? (input.period === "MONTHLY" ? user.monthlyIncomeTargetCents : null),
      items: source
        ? {
            create: source.items.map((i) => ({
              userId,
              categoryId: i.categoryId,
              label: i.label,
              amountType: i.amountType,
              amountCents: i.amountCents,
              percentBps: i.percentBps,
              rolloverEnabled: i.rolloverEnabled,
              alertThresholds: i.alertThresholds,
              sortOrder: i.sortOrder,
            })),
          }
        : undefined,
    },
  });
  await audit(userId, "budget.created", { type: "budget", id: budget.id }, { period: input.period, start, copied: Boolean(source) });
  return budget;
}

/** Like createBudget, but tells the caller whether the budget already existed (so the UI can say so). */
export async function openOrCreateBudget(userId: string, input: z.infer<typeof createBudgetSchema>): Promise<{ budget: Budget; created: boolean }> {
  if (input.period !== "CUSTOM") {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { weekStartsOn: true } });
    const { start } = periodBounds(input.period, input.startDate, input.endDate, user.weekStartsOn);
    const existing = await findBudget(userId, input.period, start);
    if (existing) return { budget: existing, created: false };
  }
  return { budget: await createBudget(userId, input), created: true };
}

/** Settings the budget pages need to start a budget or a line the way the user prefers. */
export async function budgetDefaults(userId: string) {
  const [user, prefs] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { budgetMode: true, weekStartsOn: true, monthlyIncomeTargetCents: true } }),
    userPreferences(userId),
  ]);
  return {
    mode: user.budgetMode,
    weekStartsOn: user.weekStartsOn,
    monthlyIncomeTargetCents: user.monthlyIncomeTargetCents === null ? null : toCents(user.monthlyIncomeTargetCents),
    alertThresholds: prefs.budgetAlertThresholds,
  };
}

/** Rollover carried into `month` for each category (chained up to 12 months back). */
async function computeRollovers(userId: string, month: MonthKey, categoryIds: string[]): Promise<Map<string, Cents>> {
  const result = new Map<string, Cents>();
  if (!categoryIds.length) return result;
  const firstMonth = addMonthKey(month, -12);
  const budgets = await prisma.budget.findMany({
    where: { userId, period: "MONTHLY", startDate: { gte: toDbDate(`${firstMonth}-01`), lt: toDbDate(`${month}-01`) } },
    include: { items: { where: { categoryId: { in: categoryIds } } } },
    orderBy: { startDate: "asc" },
  });
  if (!budgets.length) return result;
  const spend = await spendingByCategoryPerMonth(userId, `${firstMonth}-01`, addDays(`${month}-01`, -1));
  const spendKey = new Map(spend.map((s) => [`${s.month}|${s.categoryId}`, s.spending]));
  for (const categoryId of categoryIds) {
    let carry = 0;
    let lastMonth: MonthKey | null = null;
    for (const b of budgets) {
      const m = monthKey(fromDbDate(b.startDate));
      const item = b.items.find((i) => i.categoryId === categoryId);
      // A gap in months or a line without rollover resets the chain.
      if (!item || !item.rolloverEnabled || (lastMonth && addMonthKey(lastMonth, 1) !== m)) {
        carry = 0;
        lastMonth = item?.rolloverEnabled ? m : null;
        if (!item?.rolloverEnabled) continue;
      }
      const budgeted = resolveBudgetAmount({ amountType: item.amountType, amountCents: toCents(item.amountCents), percentBps: item.percentBps }, toCents(b.plannedIncomeCents));
      carry = calculateRollover(budgeted, spendKey.get(`${m}|${categoryId}`) ?? 0, carry);
      lastMonth = m;
    }
    if (lastMonth === addMonthKey(month, -1)) result.set(categoryId, carry);
  }
  return result;
}

export interface BudgetLineView {
  id: string;
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  amountType: "FIXED" | "PERCENT_OF_INCOME";
  percentBps: number | null;
  budgeted: Cents;
  rollover: Cents;
  rolloverEnabled: boolean;
  alertThresholds: number[];
  spent: Cents;
  available: Cents;
  remaining: Cents;
  usedBps: number;
  status: "on_track" | "warning" | "over";
}

export async function budgetView(userId: string, budgetId: string) {
  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, userId },
    include: { items: { include: { category: { select: { id: true, name: true, icon: true, color: true, kind: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!budget) throw notFound("Budget");
  const start = fromDbDate(budget.startDate);
  const end = fromDbDate(budget.endDate);
  const plannedIncome = toCents(budget.plannedIncomeCents);
  const [spending, actualIncome, rollovers, categories] = await Promise.all([
    spendingByCategory(userId, start, end),
    totalIncome(userId, start, end),
    budget.period === "MONTHLY" ? computeRollovers(userId, monthKey(start), budget.items.filter((i) => i.rolloverEnabled && i.categoryId).map((i) => i.categoryId!)) : Promise.resolve(new Map<string, Cents>()),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true, icon: true, color: true, kind: true, isHidden: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const incomeBase = plannedIncome || actualIncome;
  const lines: BudgetLineView[] = budget.items.map((i) => {
    const budgeted = resolveBudgetAmount({ amountType: i.amountType, amountCents: toCents(i.amountCents), percentBps: i.percentBps }, incomeBase);
    const rollover = i.categoryId ? (rollovers.get(i.categoryId) ?? 0) : 0;
    const spent = i.categoryId ? Math.max(0, spending.get(i.categoryId) ?? 0) : 0;
    const r = calculateBudgetRemaining(budgeted, spent, rollover, (Math.min(...i.alertThresholds, 100) || 80) * 100);
    return {
      id: i.id,
      categoryId: i.categoryId,
      name: i.category?.name ?? i.label ?? "Unassigned",
      icon: i.category?.icon ?? "piggy-bank",
      color: i.category?.color ?? "#0ea5e9",
      amountType: i.amountType,
      percentBps: i.percentBps,
      budgeted,
      rollover,
      rolloverEnabled: i.rolloverEnabled,
      alertThresholds: i.alertThresholds,
      spent,
      available: r.available,
      remaining: r.remaining,
      usedBps: r.usedBps,
      status: r.status,
    };
  });
  // Label-only lines (no category) must not hide uncategorised spending.
  const budgetedIds = new Set(budget.items.map((i) => i.categoryId).filter((id): id is string => Boolean(id)));
  const unbudgeted = [...spending.entries()]
    .filter(([id, v]) => (id === null || !budgetedIds.has(id)) && v > 0)
    .map(([id, v]) => {
      const c = categories.find((x) => x.id === id);
      return { categoryId: id, name: c?.name ?? "Uncategorized", icon: c?.icon ?? "circle-dashed", color: c?.color ?? "#94a3b8", spent: v };
    })
    .sort((a, b) => b.spent - a.spent);
  // Lines without a category (savings, debt payoff) are planned but never spent against, so
  // they count in `budgeted` (and the zero-based view) but not in what's left to spend.
  const tracked = lines.filter((l) => l.categoryId);
  const totals = {
    budgeted: lines.reduce((a, l) => a + l.budgeted, 0),
    setAside: lines.reduce((a, l) => a + (l.categoryId ? 0 : l.budgeted), 0),
    rollover: tracked.reduce((a, l) => a + l.rollover, 0),
    available: tracked.reduce((a, l) => a + l.available, 0),
    spent: tracked.reduce((a, l) => a + l.spent, 0),
    unbudgetedSpent: unbudgeted.reduce((a, u) => a + u.spent, 0),
  };
  const remaining = totals.available - totals.spent;
  const zeroBased = calculateZeroBased(incomeBase, lines.map((l) => l.budgeted));
  return {
    budget: { id: budget.id, name: budget.name, period: budget.period, mode: budget.mode, start, end, plannedIncomeCents: budget.plannedIncomeCents === null ? null : plannedIncome, notes: budget.notes },
    lines,
    unbudgeted,
    totals: { ...totals, remaining },
    income: { planned: plannedIncome, actual: actualIncome, base: incomeBase },
    zeroBased,
    availableCategories: categories.filter((c) => c.kind === "EXPENSE" && !c.isHidden && !budgetedIds.has(c.id)).map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color })),
  };
}

export type BudgetView = Awaited<ReturnType<typeof budgetView>>;

export interface BudgetHistoryPoint {
  budgetId: string;
  start: LocalDate;
  end: LocalDate;
  /** Sum of the category lines (allocation lines without a category, like savings, are left out). */
  planned: Cents;
  /** All spending in the period, budgeted or not. */
  spent: Cents;
}

/** Planned vs actual spending for up to `count` monthly or weekly budgets ending with the one starting on `throughStart`. */
export async function budgetHistory(userId: string, period: "MONTHLY" | "WEEKLY", throughStart: LocalDate, count = 6): Promise<BudgetHistoryPoint[]> {
  const rows = await prisma.budget.findMany({
    where: { userId, period, startDate: { lte: toDbDate(throughStart) } },
    orderBy: [{ startDate: "desc" }, { createdAt: "asc" }],
    take: count * 2,
    include: { items: { where: { categoryId: { not: null } } } },
  });
  const seen = new Set<string>();
  const budgets = rows.filter((b) => {
    const key = fromDbDate(b.startDate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, count).reverse();
  return Promise.all(
    budgets.map(async (b) => {
      const start = fromDbDate(b.startDate);
      const end = fromDbDate(b.endDate);
      const needsIncome = b.plannedIncomeCents === null && b.items.some((i) => i.amountType === "PERCENT_OF_INCOME");
      const [spent, actualIncome] = await Promise.all([totalSpending(userId, start, end), needsIncome ? totalIncome(userId, start, end) : Promise.resolve(0)]);
      const incomeBase = toCents(b.plannedIncomeCents) || actualIncome;
      const planned = b.items.reduce((a, i) => a + resolveBudgetAmount({ amountType: i.amountType, amountCents: toCents(i.amountCents), percentBps: i.percentBps }, incomeBase), 0);
      return { budgetId: b.id, start, end, planned, spent: Math.max(0, spent) };
    }),
  );
}

async function ownBudget(userId: string, budgetId: string) {
  const b = await prisma.budget.findFirst({ where: { id: budgetId, userId } });
  if (!b) throw notFound("Budget");
  return b;
}

export async function updateBudgetSettings(userId: string, budgetId: string, input: z.infer<typeof budgetSettingsSchema>) {
  await ownBudget(userId, budgetId);
  await prisma.budget.update({ where: { id: budgetId }, data: input });
  await audit(userId, "budget.updated", { type: "budget", id: budgetId }, { fields: Object.keys(input) });
}

export async function upsertBudgetItem(userId: string, budgetId: string, itemId: string | null, input: z.infer<typeof budgetItemInputSchema>) {
  await ownBudget(userId, budgetId);
  if (input.categoryId && !(await prisma.category.count({ where: { id: input.categoryId, userId } }))) throw notFound("Category");
  if (!input.categoryId && !input.label) throw new AppError("VALIDATION_FAILED", "Give this line a name or pick a category.");
  if (input.amountType === "PERCENT_OF_INCOME" && input.percentBps == null) throw new AppError("VALIDATION_FAILED", "Enter a percentage.");
  const data = {
    categoryId: input.categoryId,
    label: input.label ?? null,
    amountType: input.amountType,
    amountCents: input.amountType === "FIXED" ? input.amountCents : 0,
    percentBps: input.amountType === "PERCENT_OF_INCOME" ? input.percentBps : null,
    rolloverEnabled: input.rolloverEnabled,
    alertThresholds: [...new Set(input.alertThresholds)].sort((a, b) => a - b),
  };
  let item;
  if (itemId) {
    const existing = await prisma.budgetItem.findFirst({ where: { id: itemId, userId, budgetId } });
    if (!existing) throw notFound("Budget line");
    item = await prisma.budgetItem.update({ where: { id: itemId }, data });
  } else {
    const count = await prisma.budgetItem.count({ where: { budgetId } });
    item = await prisma.budgetItem.create({ data: { userId, budgetId, sortOrder: count, ...data } });
  }
  await audit(userId, "budget.updated", { type: "budget", id: budgetId }, { itemId: item.id, amountType: input.amountType });
  return item;
}

export async function deleteBudgetItem(userId: string, itemId: string) {
  const item = await prisma.budgetItem.findFirst({ where: { id: itemId, userId } });
  if (!item) throw notFound("Budget line");
  await prisma.budgetItem.delete({ where: { id: itemId } });
  await audit(userId, "budget.updated", { type: "budget", id: item.budgetId }, { deletedItem: itemId });
}

export async function deleteBudget(userId: string, budgetId: string) {
  await ownBudget(userId, budgetId);
  await prisma.budget.delete({ where: { id: budgetId } });
  await audit(userId, "budget.deleted", { type: "budget", id: budgetId });
}

/** Notifies when a budget line in the current month crosses one of its thresholds. */
export async function checkBudgetAlerts(userId: string, today: LocalDate) {
  const month = monthKey(today);
  const budget = await findBudget(userId, "MONTHLY", `${month}-01`);
  if (!budget) return;
  const view = await budgetView(userId, budget.id);
  const prefs = await userPreferences(userId);
  for (const line of view.lines) {
    if (line.available <= 0 && line.spent <= 0) continue;
    const usedPercent = Math.floor(line.usedBps / 100);
    // Thresholds below 100% fire when reached; 100% and above fire only when exceeded,
    // so a rent line that is exactly on budget doesn't raise an alarm.
    const crossed = crossedThreshold(line.usedBps, line.alertThresholds.length ? line.alertThresholds : prefs.budgetAlertThresholds);
    if (crossed !== null) {
      await notify(userId, {
        type: "BUDGET_WARNING",
        severity: crossed >= 100 ? "WARNING" : "INFO",
        title: crossed >= 100 ? `${line.name} budget is over` : `${line.name} budget is ${usedPercent}% used`,
        body: `${formatCurrency(line.spent)} spent of ${formatCurrency(line.available)} this month. ${line.remaining >= 0 ? `${formatCurrency(line.remaining)} left.` : `${formatCurrency(-line.remaining)} over.`}`,
        href: "/budget",
        dedupeKey: `budget:${line.id}:${month}:${crossed}`,
      });
    }
    await runBudgetThresholdAutomations(userId, { budgetItemId: line.id, categoryId: line.categoryId, categoryName: line.name, usedPercent, periodKey: month, spent: line.spent, available: line.available });
  }
}
