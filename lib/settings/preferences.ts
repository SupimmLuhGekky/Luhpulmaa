import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

/** Financial preferences stored in User.preferences (JSON), always read through this schema. */
export const preferencesSchema = z.object({
  /** Default alert thresholds (%) applied to new budget lines. */
  budgetAlertThresholds: z.array(z.number().int().min(1).max(200)).max(6).default([80, 100]),
  /** Outflows at or above this amount trigger a notification (0 = off). */
  largeTransactionCents: z.number().int().min(0).default(50000),
  /** Days before a bill's due date to remind. */
  billReminderDays: z.number().int().min(0).max(30).default(3),
  /** Whether savings accounts count as spendable cash in safe-to-spend. */
  includeSavingsInSafeToSpend: z.boolean().default(false),
  /** Show amounts rounded to whole dollars on overview cards. */
  roundOverviewAmounts: z.boolean().default(false),
  /** Theme preference (system/light/dark) — mirrored in a cookie for SSR. */
  theme: z.enum(["system", "light", "dark"]).default("system"),
  /** Allow optional AI features to read this user's data (off by default). */
  aiOptIn: z.boolean().default(false),
});

export type UserPreferences = z.infer<typeof preferencesSchema>;

export function parsePreferences(raw: unknown): UserPreferences {
  const parsed = preferencesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : preferencesSchema.parse({});
}

export async function userPreferences(userId: string): Promise<UserPreferences> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  return parsePreferences(user?.preferences);
}
