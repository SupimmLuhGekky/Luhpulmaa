"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { changePasswordSchema } from "@/lib/auth/schemas";
import { changePassword } from "@/lib/auth/service";
import { revokeOtherSessions, revokeSession } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";
import { prisma } from "@/lib/db/prisma";
import { RATE_LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { disconnectConnection } from "@/lib/accounts/service";
import { syncConnection } from "@/lib/sync/service";
import { preferencesPatchSchema } from "@/lib/settings/preferences";
import { deleteAccount, disconnectAllConnections, profileSchema, updatePreferences, updateProfile } from "@/lib/users/service";
import {
  categoryInputSchema,
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteMerchantRule,
  deleteSubcategory,
  reorderCategories,
  subcategoryInputSchema,
  updateCategory,
  updateSubcategory,
} from "@/lib/categories/service";

const id = z.string().uuid();

/** Every page that formats money or dates with the user's settings. */
function revalidateEverything() {
  revalidatePath("/", "layout");
}

async function limit(key: string, rule: { limit: number; windowMs: number }) {
  const rl = await rateLimit(key, rule);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a moment and try again.", { retryAfterSeconds: rl.retryAfterSeconds });
}

// ─── Profile & region ────────────────────────────────────────────────────────

export const updateProfileAction = authedAction(
  profileSchema.pick({ firstName: true, lastName: true, country: true, province: true }).extend({ province: z.string().trim().max(8).nullable() }),
  async (input, user) => {
    if (input.country === "CA" && !input.province) throw new AppError("VALIDATION_FAILED", "Choose your province or territory.", { fieldErrors: { province: ["Choose your province or territory"] } });
    await updateProfile(user.id, { ...input, province: input.country === "CA" ? input.province : null });
    revalidateEverything();
    return { saved: true };
  },
);

export const updateRegionAction = authedAction(profileSchema.pick({ currency: true, locale: true, timeZone: true, weekStartsOn: true }).required(), async (input, user) => {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { currency: true } });
  // Amounts are stored in the account's currency and are never converted, so switching the
  // display currency is only offered when multi-currency support is turned on.
  if (input.currency !== current.currency && !isEnabled("ENABLE_MULTI_CURRENCY")) {
    throw new AppError("FORBIDDEN", "Changing the currency isn't available yet. Harbour uses Canadian dollars for now.");
  }
  await updateProfile(user.id, input);
  revalidateEverything();
  return { saved: true };
});

/** Cash buffer and planning numbers stored on the profile. */
export const updatePlanningAction = authedAction(profileSchema.pick({ minCashBufferCents: true, budgetMode: true, monthlyIncomeTargetCents: true }).partial(), async (input, user) => {
  await updateProfile(user.id, input);
  revalidateEverything();
  return { saved: true };
});

export const updatePreferencesAction = authedAction(preferencesPatchSchema, async (patch, user) => {
  if (patch.aiOptIn === true && !isEnabled("ENABLE_AI_ASSISTANT") && !isEnabled("ENABLE_AI_CATEGORIZATION")) {
    throw new AppError("FEATURE_DISABLED", "AI features are turned off on this server.");
  }
  const prefs = await updatePreferences(user.id, patch);
  revalidateEverything();
  return prefs;
});

// ─── Security ────────────────────────────────────────────────────────────────

// Schemas with inline callbacks live outside the exports: a "use server" file may only export async functions.
const changePasswordInput = changePasswordSchema
  .extend({ confirmPassword: z.string().max(128) })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });

export const changePasswordAction = authedAction(
  changePasswordInput,
  async ({ currentPassword, newPassword }, user) => {
    await limit(`password-change:${user.id}`, RATE_LIMITS.passwordReset);
    if (currentPassword === newPassword) throw new AppError("VALIDATION_FAILED", "Choose a password you haven't used here before.", { fieldErrors: { newPassword: ["Use a different password"] } });
    await changePassword(user.id, user.sessionId, currentPassword, newPassword);
    revalidatePath("/settings/security");
    return { changed: true };
  },
);

export const revokeSessionAction = authedAction(z.object({ id }), async ({ id: sessionId }, user) => {
  if (sessionId === user.sessionId) throw new AppError("BAD_REQUEST", "This is the session you're using. Sign out instead.");
  const revoked = await revokeSession(user.id, sessionId);
  if (!revoked) throw new AppError("NOT_FOUND", "That session has already ended.");
  await audit(user.id, "auth.session_revoked", { type: "session", id: sessionId });
  revalidatePath("/settings/security");
  return { revoked: 1 };
});

export const revokeOtherSessionsAction = authedAction(z.object({}), async (_input, user) => {
  const revoked = await revokeOtherSessions(user.id, user.sessionId);
  if (revoked) await audit(user.id, "auth.session_revoked", { type: "session" }, { others: revoked });
  revalidatePath("/settings/security");
  return { revoked };
});

// ─── Connected services ──────────────────────────────────────────────────────

async function ownConnection(userId: string, connectionId: string) {
  const c = await prisma.providerConnection.findFirst({ where: { id: connectionId, userId }, select: { id: true, status: true } });
  if (!c) throw new AppError("NOT_FOUND", "Connection not found.");
  return c;
}

function revalidateAccounts() {
  for (const path of ["/settings/accounts", "/accounts", "/dashboard", "/transactions", "/net-worth"]) revalidatePath(path);
}

export const syncConnectionAction = authedAction(z.object({ id }), async ({ id: connectionId }, user) => {
  const c = await ownConnection(user.id, connectionId);
  if (c.status === "DISCONNECTED") throw new AppError("BAD_REQUEST", "This connection is disconnected. Reconnect it from Accounts first.");
  await limit(`sync:${user.id}`, RATE_LIMITS.sync);
  const outcome = await syncConnection(user.id, connectionId, "manual");
  revalidateAccounts();
  if (outcome.status === "FAILED") throw new AppError("PROVIDER_ERROR", outcome.message ?? "We couldn't refresh this connection. Please try again later.");
  return { status: outcome.status, added: outcome.added, message: outcome.message ?? null };
});

export const disconnectConnectionAction = authedAction(z.object({ id, deleteData: z.boolean().default(false) }), async ({ id: connectionId, deleteData }, user) => {
  await ownConnection(user.id, connectionId);
  await disconnectConnection(user.id, connectionId, deleteData);
  revalidateAccounts();
  return { disconnected: true };
});

export const disconnectAllConnectionsAction = authedAction(z.object({ confirm: z.literal(true) }), async (_input, user) => {
  const result = await disconnectAllConnections(user.id);
  revalidateAccounts();
  return result;
});

// ─── Data & privacy ──────────────────────────────────────────────────────────

const deleteAccountInput = z
  .object({ password: z.string().min(1, "Enter your password").max(128), confirmation: z.string().trim() })
  .refine((v) => v.confirmation.toUpperCase() === "DELETE", { message: "Type DELETE to confirm", path: ["confirmation"] });

export const deleteAccountAction = authedAction(
  deleteAccountInput,
  async ({ password }, user) => {
    await limit(`delete-account:${user.id}`, RATE_LIMITS.signIn);
    await deleteAccount(user.id, password);
    return { deleted: true };
  },
);

// ─── Categories ──────────────────────────────────────────────────────────────

function revalidateCategories() {
  for (const path of ["/settings/categories", "/transactions", "/budget", "/analytics", "/automations"]) revalidatePath(path);
}

export const createCategoryAction = authedAction(categoryInputSchema, async (input, user) => {
  const cat = await createCategory(user.id, input);
  revalidateCategories();
  return { id: cat.id };
});

export const updateCategoryAction = authedAction(
  z.object({ id, patch: categoryInputSchema.partial().extend({ isHidden: z.boolean().optional() }) }),
  async ({ id: categoryId, patch }, user) => {
    await updateCategory(user.id, categoryId, patch);
    revalidateCategories();
    return { id: categoryId };
  },
);

export const reorderCategoriesAction = authedAction(z.object({ ids: z.array(id).min(1).max(200) }), async ({ ids }, user) => {
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION_FAILED", "Each category can appear only once.");
  await reorderCategories(user.id, ids);
  revalidateCategories();
  return { reordered: ids.length };
});

export const deleteCategoryAction = authedAction(z.object({ id, reassignTo: id.nullable().optional() }), async ({ id: categoryId, reassignTo }, user) => {
  await deleteCategory(user.id, categoryId, reassignTo);
  revalidateCategories();
  return { deleted: true };
});

export const createSubcategoryAction = authedAction(z.object({ categoryId: id, input: subcategoryInputSchema }), async ({ categoryId, input }, user) => {
  const sub = await createSubcategory(user.id, categoryId, input);
  revalidateCategories();
  return { id: sub.id };
});

export const updateSubcategoryAction = authedAction(z.object({ id, input: subcategoryInputSchema.partial() }), async ({ id: subId, input }, user) => {
  await updateSubcategory(user.id, subId, input);
  revalidateCategories();
  return { id: subId };
});

export const deleteSubcategoryAction = authedAction(z.object({ id }), async ({ id: subId }, user) => {
  await deleteSubcategory(user.id, subId);
  revalidateCategories();
  return { deleted: true };
});

export const deleteMerchantRuleAction = authedAction(z.object({ id }), async ({ id: ruleId }, user) => {
  await deleteMerchantRule(user.id, ruleId);
  revalidatePath("/settings/categories");
  return { deleted: true };
});
