import "server-only";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { addMonthKey, fromDbDate, monthKey, monthRange, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { monthlyEquivalent } from "@/lib/finance/frequency";
import { mulDiv, toCents, type Cents } from "@/lib/finance/money";
import { spendingByCategory } from "@/lib/analytics/aggregates";
import { bankingStatus } from "@/lib/banking/registry";
import { ESSENTIAL_CATEGORY_KEYS } from "@/lib/categories/defaults";
import { isEnabled } from "@/lib/flags";
import { clampStep, ONBOARDING_STEP_COUNT, progressAfter } from "./onboarding-plan";

/** Furthest onboarding step reached (1-based) and whether setup is finished. */
export async function onboardingState(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingStep: true, onboardingCompletedAt: true } });
  return { furthest: clampStep(u.onboardingStep), completedAt: u.onboardingCompletedAt?.toISOString() ?? null };
}

/** Records that `step` was finished so the person resumes at the next one. Never moves backwards. */
export async function saveOnboardingProgress(userId: string, finishedStep: number): Promise<number> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingStep: true } });
  const next = progressAfter(finishedStep, u.onboardingStep);
  if (next !== u.onboardingStep) await prisma.user.update({ where: { id: userId }, data: { onboardingStep: next } });
  return next;
}

/** Finishes onboarding (also used by "Skip setup"). Idempotent. */
export async function completeOnboarding(userId: string, opts: { skipped?: boolean } = {}) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingCompletedAt: true } });
  if (u.onboardingCompletedAt) return { completedAt: u.onboardingCompletedAt.toISOString() };
  const completedAt = new Date();
  await prisma.user.update({ where: { id: userId }, data: { onboardingCompletedAt: completedAt, onboardingStep: ONBOARDING_STEP_COUNT } });
  await audit(userId, "settings.updated", { type: "user", id: userId }, { onboarding: opts.skipped ? "skipped" : "completed" });
  return { completedAt: completedAt.toISOString() };
}

/**
 * Average monthly spending per category over the last `months` full calendar months
 * (the current, partial month is left out). Uncategorized spending is ignored.
 */
export async function averageMonthlySpending(userId: string, timeZone: string, months = 3): Promise<Record<string, Cents>> {
  const current = monthKey(todayIn(timeZone));
  const from = monthRange(addMonthKey(current, -months)).start;
  const to = monthRange(addMonthKey(current, -1)).end;
  const totals = await spendingByCategory(userId, from, to);
  const out: Record<string, Cents> = {};
  for (const [categoryId, cents] of totals) {
    if (categoryId && cents > 0) out[categoryId] = mulDiv(cents, 1, months);
  }
  return out;
}

/** Which ways of adding accounts this server offers during onboarding. */
export function onboardingIntegrations() {
  const banking = bankingStatus();
  return {
    demoBank: banking.enabled && banking.simulated,
    realBank: banking.enabled && banking.configured && !banking.simulated,
    providerName: banking.displayName,
    csvImport: isEnabled("ENABLE_CSV_IMPORT"),
  };
}

/** The primary income source (prefills the income step when someone comes back to it). */
export async function primaryIncome(userId: string) {
  const s = await prisma.incomeSource.findFirst({ where: { userId, isPrimary: true, isActive: true }, orderBy: { createdAt: "asc" } });
  if (!s) return null;
  const averageAmountCents = toCents(s.averageAmountCents);
  return {
    name: s.name,
    frequency: s.frequency,
    averageAmountCents,
    monthlyCents: monthlyEquivalent(averageAmountCents, s.frequency),
    nextExpectedDate: fromDbDate(s.nextExpectedDate),
  };
}

/** This month's monthly budget, if there is one, with its lines. */
export async function currentMonthBudget(userId: string, timeZone: string) {
  const start: LocalDate = `${monthKey(todayIn(timeZone))}-01`;
  const budget = await prisma.budget.findFirst({
    where: { userId, period: "MONTHLY", startDate: toDbDate(start) },
    orderBy: { createdAt: "asc" },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { category: { select: { name: true, systemKey: true, icon: true, color: true } } } } },
  });
  if (!budget) return null;
  const lines = budget.items.map((i) => ({
    name: i.category?.name ?? i.label ?? "Other",
    icon: i.category?.icon ?? null,
    color: i.category?.color ?? null,
    amountCents: toCents(i.amountCents),
    essential: Boolean(i.category?.systemKey && ESSENTIAL_CATEGORY_KEYS.has(i.category.systemKey)),
  }));
  return {
    id: budget.id,
    month: monthKey(start),
    plannedIncomeCents: budget.plannedIncomeCents === null ? null : toCents(budget.plannedIncomeCents),
    lines,
    totalCents: lines.reduce((a, l) => a + l.amountCents, 0),
  };
}

/** Active savings goals (first few), to mention on the goal step and the summary. */
export async function activeGoalSummaries(userId: string, take = 5) {
  const goals = await prisma.goal.findMany({ where: { userId, status: "ACTIVE" }, select: { name: true, targetCents: true }, orderBy: { createdAt: "asc" }, take });
  return goals.map((g) => ({ name: g.name, targetCents: toCents(g.targetCents) }));
}

/** What setup produced, for the last step. Everything comes from the person's own records. */
export async function onboardingSummary(userId: string, timeZone: string) {
  const [income, accounts, budget, goals] = await Promise.all([
    primaryIncome(userId),
    prisma.account.findMany({ where: { userId, status: { not: "CLOSED" }, isHidden: false }, select: { name: true, isManual: true }, orderBy: { createdAt: "asc" } }),
    currentMonthBudget(userId, timeZone),
    activeGoalSummaries(userId),
  ]);
  return {
    income,
    accounts: { count: accounts.length, names: accounts.slice(0, 4).map((a) => a.name) },
    budget: budget ? { month: budget.month, lines: budget.lines.length, totalCents: budget.totalCents } : null,
    goals,
  };
}
