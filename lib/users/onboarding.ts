import "server-only";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { addMonthKey, monthKey, monthRange, todayIn } from "@/lib/dates";
import { mulDiv, type Cents } from "@/lib/finance/money";
import { spendingByCategory } from "@/lib/analytics/aggregates";
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
