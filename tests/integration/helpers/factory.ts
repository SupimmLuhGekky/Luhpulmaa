/**
 * Test-data builders. Every name, email and amount here is fictional.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { provisionDefaultCategories } from "@/lib/categories/provision";
import { provisionNotificationPreferences } from "@/lib/notifications/preferences";
import { createManualAccount } from "@/lib/accounts/service";
import { ingestTransactions, type IngestRow } from "@/lib/transactions/ingest";
import { requestContext } from "./next-headers";

export const TEST_PASSWORD = "harbour-test-pass-1";
// Low bcrypt cost keeps factory users fast; real sign-ups use the production cost.
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

/** Freezes the clock (Date only; timers and I/O keep running). Default: 2026-10-01 12:00 in Toronto. */
export function freezeTime(iso = "2026-10-01T16:00:00Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

export function uniqueEmail(label = "user") {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

export async function createUser(over: { email?: string; firstName?: string; timeZone?: string; minCashBufferCents?: number; onboarded?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: over.email ?? uniqueEmail(),
        passwordHash: TEST_PASSWORD_HASH,
        firstName: over.firstName ?? "Alex",
        lastName: "Fictional",
        timeZone: over.timeZone ?? "America/Toronto",
        minCashBufferCents: over.minCashBufferCents ?? 50000,
        onboardingCompletedAt: over.onboarded === false ? null : new Date(),
      },
    });
    await provisionDefaultCategories(tx, user.id);
    await provisionNotificationPreferences(tx, user.id);
    return user;
  });
}

export async function categoryId(userId: string, systemKey: string): Promise<string> {
  const c = await prisma.category.findFirstOrThrow({ where: { userId, systemKey } });
  return c.id;
}

export async function subcategoryId(userId: string, systemKey: string, name: string): Promise<string> {
  const c = await prisma.subcategory.findFirstOrThrow({ where: { userId, name, category: { systemKey } } });
  return c.id;
}

export async function manualAccount(userId: string, over: Partial<Parameters<typeof createManualAccount>[1]> = {}) {
  return createManualAccount(userId, { name: "Everyday Chequing", type: "CHEQUING", currency: "CAD", balanceCents: 0, ...over });
}

/** Inserts transactions through the real ingest pipeline (categorisation, merchants) without automations. */
export async function seedTransactions(userId: string, accountId: string, rows: Omit<IngestRow, "accountId">[], opts: { runAutomations?: boolean } = {}) {
  return ingestTransactions(
    userId,
    rows.map((r) => ({ accountId, ...r })),
    { runAutomations: opts.runAutomations ?? false, notify: false },
  );
}

export async function balanceOf(accountId: string): Promise<number> {
  const a = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { currentBalanceCents: true } });
  return Number(a.currentBalanceCents);
}

/** Signs the in-memory browser in as `userId` with a real database session. */
export async function signInAs(userId: string) {
  const { createSession } = await import("@/lib/auth/session");
  requestContext.reset();
  await createSession(userId);
}
