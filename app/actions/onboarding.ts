"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { monthKey, todayIn } from "@/lib/dates";
import { monthlyEquivalent } from "@/lib/finance/frequency";
import { RATE_LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { bankingStatus } from "@/lib/banking/registry";
import { ProviderError } from "@/lib/banking/types";
import { completeConnection, createManualAccount, manualAccountSchema, mockInstitutions } from "@/lib/accounts/service";
import { createBudget, findBudget, upsertBudgetItem } from "@/lib/budget/service";
import { createGoal, goalInputSchema } from "@/lib/goals/service";
import { incomeSourceSchema, upsertIncomeSource } from "@/lib/income/service";
import { updatePreference } from "@/lib/notifications/service";
import { APP_GOAL_KEYS } from "@/lib/settings/options";
import { userPreferences } from "@/lib/settings/preferences";
import { completeOnboarding, saveOnboardingProgress } from "@/lib/users/onboarding";
import { stepNumber } from "@/lib/users/onboarding-plan";
import { CANADIAN_PROVINCES, profileSchema, updatePreferences, updateProfile } from "@/lib/users/service";

const step = z.number().int().min(1).max(9);

/** Moves on without saving anything (Welcome, "Skip" on optional steps, "Continue" on Accounts). */
export const advanceOnboardingAction = authedAction(z.object({ from: step }), async ({ from }, user) => {
  const furthest = await saveOnboardingProgress(user.id, from);
  return { next: Math.min(9, from + 1), furthest };
});

// Schemas with inline callbacks live outside the exports: a "use server" file may only export async functions.
const PROVINCE_CODES = CANADIAN_PROVINCES.map((p) => p.code) as [string, ...string[]];
const onboardingProfileInput = profileSchema.pick({ firstName: true, lastName: true, locale: true, timeZone: true }).extend({
  province: z.enum(PROVINCE_CODES, { errorMap: () => ({ message: "Choose your province or territory" }) }),
});

export const saveOnboardingProfileAction = authedAction(
  onboardingProfileInput,
  async (input, user) => {
    await updateProfile(user.id, { ...input, country: "CA" });
    await saveOnboardingProgress(user.id, stepNumber("profile"));
    revalidatePath("/onboarding");
    return { next: stepNumber("profile") + 1 };
  },
);

export const saveOnboardingGoalsAction = authedAction(z.object({ appGoals: z.array(z.enum(APP_GOAL_KEYS)).max(APP_GOAL_KEYS.length) }), async ({ appGoals }, user) => {
  await updatePreferences(user.id, { appGoals: [...new Set(appGoals)] });
  await saveOnboardingProgress(user.id, stepNumber("goals"));
  return { next: stepNumber("goals") + 1 };
});

/** Creates (or updates, when revisiting the step) the primary income source. */
export const saveOnboardingIncomeAction = authedAction(incomeSourceSchema.pick({ name: true, frequency: true, averageAmountCents: true, nextExpectedDate: true }), async (input, user) => {
  const existing = await prisma.incomeSource.findFirst({ where: { userId: user.id, isPrimary: true, isActive: true }, select: { id: true } });
  await upsertIncomeSource(user.id, existing?.id ?? null, { ...input, isPrimary: true });
  // Monthly budgets use this as their planned income.
  await updateProfile(user.id, { monthlyIncomeTargetCents: monthlyEquivalent(input.averageAmountCents, input.frequency) });
  await saveOnboardingProgress(user.id, stepNumber("income"));
  revalidatePath("/income");
  return { next: stepNumber("income") + 1 };
});

export const addOnboardingAccountAction = authedAction(manualAccountSchema, async (input, user) => {
  const count = await prisma.account.count({ where: { userId: user.id } });
  if (count >= 50) throw new AppError("CONFLICT", "You can add more accounts later from the Accounts page.");
  const account = await createManualAccount(user.id, input);
  return { id: account.id, name: account.name };
});

/** Links a simulated demo bank (only when the server runs the mock provider). */
export const connectOnboardingDemoBankAction = authedAction(z.object({ institutionId: z.string().max(40) }), async ({ institutionId }, user) => {
  const status = bankingStatus();
  if (!status.enabled || !status.simulated) throw new AppError("FEATURE_DISABLED", "The demo bank isn't available on this server.");
  if (!mockInstitutions().some((i) => i.id === institutionId)) throw new AppError("BAD_REQUEST", "Choose a demo bank.");
  const rl = await rateLimit(`sync:${user.id}`, RATE_LIMITS.sync);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Too many connection attempts. Please wait a moment.", { retryAfterSeconds: rl.retryAfterSeconds });
  try {
    const result = await completeConnection(user.id, `mock-public:${institutionId}`);
    return { institution: result.institution, accounts: result.accounts, added: result.sync.added, failed: result.sync.status === "FAILED" ? (result.sync.message ?? "The first sync failed.") : null };
  } catch (error) {
    if (error instanceof ProviderError) throw new AppError("PROVIDER_ERROR", error.message);
    throw error;
  }
});

/** Creates this month's budget from the reviewed suggestion. */
export const createOnboardingBudgetAction = authedAction(
  z.object({
    plannedIncomeCents: z.number().int().min(0).max(100_000_000).nullable(),
    lines: z
      .array(z.object({ categoryId: z.string().uuid(), amountCents: z.number().int().min(0).max(100_000_000) }))
      .min(1, "Add at least one budget line")
      .max(40),
  }),
  async ({ plannedIncomeCents, lines }, user) => {
    const today = todayIn(user.timeZone);
    const start = `${monthKey(today)}-01`;
    const existing = await findBudget(user.id, "MONTHLY", start);
    if (existing) throw new AppError("CONFLICT", "You already have a budget for this month. You can change it on the Budget page.");
    const prefs = await userPreferences(user.id);
    const budget = await createBudget(user.id, { period: "MONTHLY", startDate: start, copyFromPrevious: false, plannedIncomeCents });
    const unique = new Map(lines.filter((l) => l.amountCents > 0).map((l) => [l.categoryId, l.amountCents]));
    for (const [categoryId, amountCents] of unique) {
      await upsertBudgetItem(user.id, budget.id, null, {
        categoryId,
        amountType: "FIXED",
        amountCents,
        rolloverEnabled: prefs.budgetRolloverDefault,
        alertThresholds: prefs.budgetAlertThresholds,
      });
    }
    await saveOnboardingProgress(user.id, stepNumber("budget"));
    revalidatePath("/budget");
    return { budgetId: budget.id, lines: unique.size, next: stepNumber("budget") + 1 };
  },
);

export const createOnboardingGoalAction = authedAction(goalInputSchema, async (input, user) => {
  const goal = await createGoal(user.id, input, "ONBOARDING");
  await saveOnboardingProgress(user.id, stepNumber("goal"));
  revalidatePath("/goals");
  return { id: goal.id, next: stepNumber("goal") + 1 };
});

const notificationType = z.enum(["BUDGET_WARNING", "GOAL_PROGRESS", "GOAL_DEADLINE", "UPCOMING_BILL", "SUBSCRIPTION", "LARGE_TRANSACTION", "SYNC_FAILURE", "PAYDAY", "AUTOMATION", "SYSTEM"]);

/** `email` is left out when email can't be sent here, so a stored choice isn't overwritten. */
export const saveOnboardingNotificationsAction = authedAction(
  z.object({ preferences: z.array(z.object({ type: notificationType, inApp: z.boolean(), email: z.boolean().optional() })).max(20) }),
  async ({ preferences }, user) => {
    for (const p of preferences) await updatePreference(user.id, p.type, { inApp: p.inApp, ...(p.email === undefined ? {} : { email: p.email }) });
    await saveOnboardingProgress(user.id, stepNumber("notifications"));
    return { next: stepNumber("notifications") + 1 };
  },
);

/** Finishes setup ("Go to dashboard") or skips the rest of it ("Skip setup"). */
export const completeOnboardingAction = authedAction(z.object({ skipped: z.boolean().default(false) }), async ({ skipped }, user) => {
  const result = await completeOnboarding(user.id, { skipped });
  revalidatePath("/", "layout");
  return result;
});
