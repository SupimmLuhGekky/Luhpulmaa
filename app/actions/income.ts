"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { todayIn } from "@/lib/dates";
import { allocationPlanSchema, applyAllocationPlan, deleteAllocationPlan, deleteIncomeSource, incomeSourceSchema, saveAllocationPlan, setPrimaryIncomeSource, upsertIncomeSource } from "@/lib/income/service";

const id = z.string().uuid();

/** Paydays feed the forecast and safe-to-spend; applied plans change goals. */
function revalidateIncomeViews(goals = false) {
  for (const path of ["/income", "/dashboard", "/forecast"]) revalidatePath(path);
  if (goals) revalidatePath("/goals", "layout");
}

export const saveIncomeSourceAction = authedAction(z.object({ id: id.nullable(), source: incomeSourceSchema }), async ({ id: sourceId, source }, user) => {
  const saved = await upsertIncomeSource(user.id, sourceId, source);
  revalidateIncomeViews();
  return { id: saved.id };
});

export const deleteIncomeSourceAction = authedAction(z.object({ id }), async ({ id: sourceId }, user) => {
  await deleteIncomeSource(user.id, sourceId);
  revalidateIncomeViews();
  return { deleted: true };
});

export const setPrimaryIncomeSourceAction = authedAction(z.object({ id }), async ({ id: sourceId }, user) => {
  await setPrimaryIncomeSource(user.id, sourceId);
  revalidateIncomeViews();
  return { updated: true };
});

export const saveAllocationPlanAction = authedAction(z.object({ id: id.nullable(), plan: allocationPlanSchema }), async ({ id: planId, plan }, user) => {
  const saved = await saveAllocationPlan(user.id, planId, plan);
  revalidateIncomeViews();
  return { id: saved.id };
});

export const deleteAllocationPlanAction = authedAction(z.object({ id }), async ({ id: planId }, user) => {
  await deleteAllocationPlan(user.id, planId);
  revalidateIncomeViews();
  return { deleted: true };
});

/** Records the plan's goal lines as PLANNED allocations for one paycheque. Nothing moves. */
export const applyAllocationPlanAction = authedAction(
  z.object({ planId: id, incomeCents: z.number().int().positive("Enter the paycheque amount").max(100_000_000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date") }),
  async ({ planId, incomeCents, date }, user) => {
    // Earmarks follow money that arrived: a future payday would show up as saved before it's paid.
    if (date > todayIn(user.timeZone)) throw new AppError("VALIDATION_FAILED", "Pick a payday that has already happened.", { fieldErrors: { date: ["Pick a payday that has already happened."] } });
    const result = await applyAllocationPlan(user.id, planId, incomeCents, date);
    revalidateIncomeViews(true);
    return { recorded: result.recorded, recordedCents: result.recordedCents, alreadyApplied: result.alreadyApplied, skippedArchived: result.skippedArchived };
  },
);
