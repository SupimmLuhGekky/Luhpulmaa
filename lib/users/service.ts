import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { isValidTimeZone } from "@/lib/dates";
import { verifyPassword } from "@/lib/auth/password";
import { destroyCurrentSession } from "@/lib/auth/session";
import { disconnectConnection } from "@/lib/accounts/service";
import { parsePreferences, preferencesSchema } from "@/lib/settings/preferences";

export const CANADIAN_PROVINCES = [
  { code: "QC", name: "Québec" },
  { code: "ON", name: "Ontario" },
  { code: "BC", name: "British Columbia" },
  { code: "AB", name: "Alberta" },
  { code: "MB", name: "Manitoba" },
  { code: "SK", name: "Saskatchewan" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "YT", name: "Yukon" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NU", name: "Nunavut" },
] as const;

export const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  country: z.enum(["CA", "US"]),
  province: z.string().trim().max(8).nullable().optional(),
  currency: z.enum(["CAD", "USD", "EUR", "GBP"]),
  locale: z.enum(["en-CA", "fr-CA", "en-US"]),
  timeZone: z.string().refine(isValidTimeZone, "Unknown time zone"),
  monthlyIncomeTargetCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  minCashBufferCents: z.number().int().min(0).max(100_000_000).optional(),
  budgetMode: z.enum(["STANDARD", "ZERO_BASED"]).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
});

export async function getProfile(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    emailVerified: Boolean(u.emailVerifiedAt),
    country: u.country,
    province: u.province,
    currency: u.currency,
    locale: u.locale,
    timeZone: u.timeZone,
    monthlyIncomeTargetCents: u.monthlyIncomeTargetCents === null ? null : Number(u.monthlyIncomeTargetCents),
    minCashBufferCents: Number(u.minCashBufferCents),
    budgetMode: u.budgetMode,
    weekStartsOn: u.weekStartsOn,
    preferences: parsePreferences(u.preferences),
    isDemo: u.isDemo,
    createdAt: u.createdAt.toISOString(),
  };
}

export type Profile = Awaited<ReturnType<typeof getProfile>>;

export async function updateProfile(userId: string, input: Partial<z.infer<typeof profileSchema>>) {
  if (input.country === "CA" && input.province && !CANADIAN_PROVINCES.some((p) => p.code === input.province)) {
    throw new AppError("VALIDATION_FAILED", "Choose a Canadian province or territory.");
  }
  await prisma.user.update({ where: { id: userId }, data: input });
  await audit(userId, "settings.updated", { type: "user", id: userId }, { fields: Object.keys(input) });
}

export async function updatePreferences(userId: string, patch: Partial<z.infer<typeof preferencesSchema>>) {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } });
  const next = preferencesSchema.parse({ ...parsePreferences(current.preferences), ...patch });
  await prisma.user.update({ where: { id: userId }, data: { preferences: next as Prisma.InputJsonValue } });
  await audit(userId, "settings.updated", { type: "preferences", id: userId }, { fields: Object.keys(patch) });
  return next;
}

/** Permanently deletes the user and all their data after re-verifying the password. */
export async function deleteAccount(userId: string, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.isDemo) throw new AppError("FORBIDDEN", "The shared demo account can't be deleted.");
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("VALIDATION_FAILED", "Password is incorrect.", { fieldErrors: { password: ["Incorrect password"] } });
  }
  const connections = await prisma.providerConnection.findMany({ where: { userId, status: { not: "DISCONNECTED" } }, select: { id: true } });
  for (const c of connections) await disconnectConnection(userId, c.id, true);
  await audit(userId, "user.deleted", { type: "user", id: userId });
  await prisma.$transaction([
    // Ledger rows are Restrict by design; none exist in v1, but clear any defensively.
    prisma.ledgerJournalEntry.deleteMany({ where: { userId, entries: { none: {} } } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  await destroyCurrentSession();
}

export async function listAuditLog(userId: string, take = 50) {
  const rows = await prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({ id: r.id, action: r.action, resourceType: r.resourceType, createdAt: r.createdAt.toISOString(), ipAddress: r.ipAddress, metadata: r.metadata }));
}
