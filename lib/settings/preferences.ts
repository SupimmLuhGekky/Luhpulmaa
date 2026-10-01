import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { APP_GOAL_KEYS } from "./options";

/** Validators for each preference (no defaults: used to validate changes strictly). */
const fields = {
  /** Default alert thresholds (%) applied to new budget lines. */
  budgetAlertThresholds: z.array(z.number().int().min(1).max(200)).max(6),
  /** Whether new budget lines carry unspent money into the next month by default. */
  budgetRolloverDefault: z.boolean(),
  /** Outflows at or above this amount trigger a notification (0 = off). */
  largeTransactionCents: z.number().int().min(0).max(100_000_000),
  /** Days before a bill's due date to remind. */
  billReminderDays: z.number().int().min(0).max(30),
  /** Whether savings accounts count as spendable cash in safe-to-spend. */
  includeSavingsInSafeToSpend: z.boolean(),
  /** Show amounts rounded to whole dollars on overview cards. */
  roundOverviewAmounts: z.boolean(),
  /** How "add money to a goal" is recorded by default: a plan, or money the user moved themselves. */
  goalContributionKind: z.enum(["PLANNED_ALLOCATION", "USER_REPORTED_TRANSFER"]),
  /** What the person wants Harbour to help with (from onboarding). */
  appGoals: z.array(z.enum(APP_GOAL_KEYS)).max(APP_GOAL_KEYS.length),
  /** Theme preference (system/light/dark). The active theme itself is kept by next-themes on each device. */
  theme: z.enum(["system", "light", "dark"]),
  /** Allow optional AI features to read this user's data (off by default). */
  aiOptIn: z.boolean(),
};

type Fields = typeof fields;
export type UserPreferences = { [K in keyof Fields]: z.infer<Fields[K]> };

export const DEFAULT_PREFERENCES: UserPreferences = {
  budgetAlertThresholds: [80, 100],
  budgetRolloverDefault: false,
  largeTransactionCents: 50000,
  billReminderDays: 3,
  includeSavingsInSafeToSpend: false,
  roundOverviewAmounts: false,
  goalContributionKind: "PLANNED_ALLOCATION",
  appGoals: [],
  theme: "system",
  aiOptIn: false,
};

/** Financial preferences stored in User.preferences (JSON), with defaults for missing keys. */
export const preferencesSchema = z.object({
  budgetAlertThresholds: fields.budgetAlertThresholds.default(DEFAULT_PREFERENCES.budgetAlertThresholds),
  budgetRolloverDefault: fields.budgetRolloverDefault.default(DEFAULT_PREFERENCES.budgetRolloverDefault),
  largeTransactionCents: fields.largeTransactionCents.default(DEFAULT_PREFERENCES.largeTransactionCents),
  billReminderDays: fields.billReminderDays.default(DEFAULT_PREFERENCES.billReminderDays),
  includeSavingsInSafeToSpend: fields.includeSavingsInSafeToSpend.default(DEFAULT_PREFERENCES.includeSavingsInSafeToSpend),
  roundOverviewAmounts: fields.roundOverviewAmounts.default(DEFAULT_PREFERENCES.roundOverviewAmounts),
  goalContributionKind: fields.goalContributionKind.default(DEFAULT_PREFERENCES.goalContributionKind),
  appGoals: fields.appGoals.default(DEFAULT_PREFERENCES.appGoals),
  theme: fields.theme.default(DEFAULT_PREFERENCES.theme),
  aiOptIn: fields.aiOptIn.default(DEFAULT_PREFERENCES.aiOptIn),
});

/** A partial update: every given key must be valid, unknown keys are rejected. */
export const preferencesPatchSchema = z.object(fields).partial().strict();
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

/**
 * Reads stored preferences leniently: each key is validated on its own, so one bad or
 * outdated value falls back to its default without resetting the others.
 */
export function parsePreferences(raw: unknown): UserPreferences {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PREFERENCES } as Record<string, unknown>;
  for (const key of Object.keys(fields) as (keyof Fields)[]) {
    const parsed = fields[key].safeParse(source[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as UserPreferences;
}

export async function userPreferences(userId: string): Promise<UserPreferences> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  return parsePreferences(user?.preferences);
}
