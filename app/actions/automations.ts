"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { isEnabled } from "@/lib/flags";
import { formatCurrency } from "@/lib/finance/money";
import { automationInputSchema } from "@/lib/automation/schemas";
import {
  applyToRecent,
  createAutomation,
  deleteAutomation,
  listRuns,
  previewAutomation,
  previewInputSchema,
  setAutomationActive,
  updateAutomation,
} from "@/lib/automation/service";

const id = z.string().uuid();

function assertEnabled() {
  if (!isEnabled("ENABLE_AUTOMATIONS")) throw new AppError("FEATURE_DISABLED", "Automations are turned off on this server.");
}

function revalidateAutomations(automationId?: string) {
  revalidatePath("/automations");
  if (automationId) revalidatePath(`/automations/${automationId}`);
}

/** Pages whose numbers can change when an automation edits transactions or plans goal money. */
function revalidateMoneyViews() {
  for (const path of ["/dashboard", "/transactions", "/budget", "/goals", "/analytics", "/forecast"]) revalidatePath(path);
}

export const createAutomationAction = authedAction(automationInputSchema, async (input, user) => {
  assertEnabled();
  const created = await createAutomation(user.id, input);
  revalidateAutomations(created.id);
  return { id: created.id };
});

export const updateAutomationAction = authedAction(z.object({ id, input: automationInputSchema }), async ({ id: automationId, input }, user) => {
  assertEnabled();
  await updateAutomation(user.id, automationId, input);
  revalidateAutomations(automationId);
  return { id: automationId };
});

export const setAutomationActiveAction = authedAction(z.object({ id, isActive: z.boolean() }), async ({ id: automationId, isActive }, user) => {
  assertEnabled();
  await setAutomationActive(user.id, automationId, isActive);
  revalidateAutomations(automationId);
  return { isActive };
});

export const deleteAutomationAction = authedAction(z.object({ id }), async ({ id: automationId }, user) => {
  assertEnabled();
  await deleteAutomation(user.id, automationId);
  revalidateAutomations();
  return { deleted: true };
});

/** Dry run over the last 90 days. Writes nothing. */
export const previewAutomationAction = authedAction(previewInputSchema, async (input, user) => {
  assertEnabled();
  const money = (cents: number) => formatCurrency(cents, { currency: user.currency, locale: user.locale, hideZeroCents: true });
  return previewAutomation(user.id, input, money);
});

export const applyAutomationToRecentAction = authedAction(z.object({ id, days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }), async ({ id: automationId, days }, user) => {
  assertEnabled();
  const result = await applyToRecent(user.id, automationId, days);
  revalidateAutomations(automationId);
  if (result.applied > 0) revalidateMoneyViews();
  return result;
});

export const listAutomationRunsAction = authedAction(z.object({ automationId: id.optional(), cursor: id.optional() }), async ({ automationId, cursor }, user) => {
  assertEnabled();
  return listRuns(user.id, { automationId, cursor, take: 20 });
});
