"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { todayIn } from "@/lib/dates";
import { addContribution, contributionInputSchema, createGoal, deleteContribution, deleteGoal, goalInputSchema, goalUpdateSchema, updateGoal } from "@/lib/goals/service";

const id = z.string().uuid();

/** Pages that show goal amounts (the forecast and dashboard include planned savings). */
function revalidateGoalViews(goalId?: string) {
  for (const path of ["/goals", "/dashboard", "/forecast", "/income"]) revalidatePath(path);
  if (goalId) revalidatePath(`/goals/${goalId}`);
}

export const createGoalAction = authedAction(goalInputSchema, async (input, user) => {
  const goal = await createGoal(user.id, input);
  revalidateGoalViews(goal.id);
  return { id: goal.id };
});

export const updateGoalAction = authedAction(z.object({ id, patch: goalUpdateSchema }), async ({ id: goalId, patch }, user) => {
  const goal = await updateGoal(user.id, goalId, patch);
  revalidateGoalViews(goalId);
  return { id: goal.id, status: goal.status };
});

export const deleteGoalAction = authedAction(z.object({ id }), async ({ id: goalId }, user) => {
  await deleteGoal(user.id, goalId);
  revalidateGoalViews(goalId);
  return { deleted: true };
});

/**
 * Records money for a goal. PLANNED_ALLOCATION is an earmark (nothing moves);
 * USER_REPORTED_TRANSFER is money the user says they moved themselves.
 */
export const addContributionAction = authedAction(contributionInputSchema.extend({ goalId: id }), async ({ goalId, ...input }, user) => {
  if (input.date > todayIn(user.timeZone)) throw new AppError("VALIDATION_FAILED", "Pick today or an earlier date.", { fieldErrors: { date: ["Pick today or an earlier date."] } });
  const c = await addContribution(user.id, goalId, { amountCents: input.amountCents, date: input.date, kind: input.kind, note: input.note ?? null, source: "MANUAL" });
  revalidateGoalViews(goalId);
  return { id: c?.id ?? null };
});

export const deleteContributionAction = authedAction(z.object({ id, goalId: id }), async ({ id: contributionId, goalId }, user) => {
  await deleteContribution(user.id, contributionId);
  revalidateGoalViews(goalId);
  return { deleted: true };
});
