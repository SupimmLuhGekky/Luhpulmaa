"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { ACCOUNT_TYPES, createManualAccount } from "@/lib/accounts/service";
import { commitImport, previewImport, undoImport } from "@/lib/import/service";
import { importPayloadSchema } from "@/lib/import/normalize";
import { isEnabled } from "@/lib/flags";
import { rateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";

function revalidateMoneyViews() {
  for (const path of ["/dashboard", "/transactions", "/transactions/import", "/accounts", "/budget", "/analytics", "/goals", "/forecast", "/net-worth", "/subscriptions", "/bills"]) revalidatePath(path);
}

function assertImportEnabled() {
  if (!isEnabled("ENABLE_CSV_IMPORT")) throw new AppError("FEATURE_DISABLED", "CSV import is turned off on this server.");
}

/** Checks the mapped rows against what's already in the account (nothing is saved). */
export const previewImportAction = authedAction(importPayloadSchema, async (payload, user) => {
  assertImportEnabled();
  return previewImport(user.id, payload);
});

export const commitImportAction = authedAction(importPayloadSchema, async (payload, user) => {
  assertImportEnabled();
  const rl = await rateLimit(`import:${user.id}`, RATE_LIMITS.import);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "That's a lot of imports in a short time. Please wait a little and try again.", { retryAfterSeconds: rl.retryAfterSeconds });
  const result = await commitImport(user.id, payload);
  revalidateMoneyViews();
  return result;
});

export const undoImportAction = authedAction(z.object({ batchId: z.string().uuid() }), async ({ batchId }, user) => {
  const result = await undoImport(user.id, batchId);
  revalidateMoneyViews();
  return result;
});

/** Creates the account a CSV file belongs to, straight from the import screen. */
export const createImportAccountAction = authedAction(
  z.object({
    name: z.string().trim().min(1, "Give the account a name").max(60),
    type: z.enum(ACCOUNT_TYPES),
    institutionName: z.string().trim().max(60).optional(),
    balanceCents: z.number().int().min(-100_000_000_00).max(100_000_000_00).default(0),
  }),
  async (input, user) => {
    const account = await createManualAccount(user.id, { ...input, currency: "CAD", institutionName: input.institutionName || undefined });
    revalidatePath("/accounts");
    revalidatePath("/dashboard");
    return { id: account.id, name: account.name, type: account.type };
  },
);
