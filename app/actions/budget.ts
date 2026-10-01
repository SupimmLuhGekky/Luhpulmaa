"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { budgetItemInputSchema, budgetSettingsSchema, createBudgetSchema, deleteBudget, deleteBudgetItem, openOrCreateBudget, updateBudgetSettings, upsertBudgetItem } from "@/lib/budget/service";
import { fromDbDate } from "@/lib/dates";

const id = z.string().uuid();

/** Pages that show budget numbers (safe-to-spend reserves budgeted essentials). */
function revalidateBudgetViews() {
  for (const path of ["/budget", "/dashboard", "/forecast"]) revalidatePath(path);
}

export const createBudgetAction = authedAction(createBudgetSchema, async (input, user) => {
  const { budget, created } = await openOrCreateBudget(user.id, input);
  revalidateBudgetViews();
  return { id: budget.id, period: budget.period, start: fromDbDate(budget.startDate), end: fromDbDate(budget.endDate), created };
});

export const updateBudgetSettingsAction = authedAction(z.object({ budgetId: id, settings: budgetSettingsSchema }), async ({ budgetId, settings }, user) => {
  await updateBudgetSettings(user.id, budgetId, settings);
  revalidateBudgetViews();
  return { updated: true };
});

export const saveBudgetLineAction = authedAction(z.object({ budgetId: id, itemId: id.nullable(), line: budgetItemInputSchema }), async ({ budgetId, itemId, line }, user) => {
  try {
    const item = await upsertBudgetItem(user.id, budgetId, itemId, line);
    revalidateBudgetViews();
    return { id: item.id };
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") throw new AppError("CONFLICT", "This category already has a line in this budget. Edit that line instead.");
    throw error;
  }
});

export const deleteBudgetLineAction = authedAction(z.object({ itemId: id }), async ({ itemId }, user) => {
  await deleteBudgetItem(user.id, itemId);
  revalidateBudgetViews();
  return { deleted: true };
});

export const deleteBudgetAction = authedAction(z.object({ budgetId: id }), async ({ budgetId }, user) => {
  await deleteBudget(user.id, budgetId);
  revalidateBudgetViews();
  return { deleted: true };
});
