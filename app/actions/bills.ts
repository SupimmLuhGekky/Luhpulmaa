"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { isLocalDate } from "@/lib/dates";
import { billInputSchema, createBill, deleteBill, setBillPaid, updateBill } from "@/lib/bills/service";

const id = z.string().uuid();
const localDate = z.string().refine(isLocalDate, "Pick a valid date");

/** Pages that show bills or money set aside for them. */
function revalidateBillViews() {
  for (const path of ["/bills", "/forecast", "/dashboard"]) revalidatePath(path);
}

export const createBillAction = authedAction(billInputSchema, async (input, user) => {
  const bill = await createBill(user.id, input);
  revalidateBillViews();
  return { id: bill.id };
});

export const updateBillAction = authedAction(z.object({ id, patch: billInputSchema.partial().extend({ isActive: z.boolean().optional() }) }), async ({ id: billId, patch }, user) => {
  await updateBill(user.id, billId, patch);
  revalidateBillViews();
  return { id: billId };
});

export const deleteBillAction = authedAction(z.object({ id }), async ({ id: billId }, user) => {
  await deleteBill(user.id, billId);
  revalidateBillViews();
  return { deleted: true };
});

/** Records that the user paid (or didn't pay) one occurrence. Harbour never moves money. */
export const setBillPaidAction = authedAction(
  z.object({ billId: id, dueDate: localDate, paid: z.boolean(), amountCents: z.number().int().positive().max(100_000_000).optional() }),
  async ({ billId, dueDate, paid, amountCents }, user) => {
    await setBillPaid(user.id, billId, dueDate, paid, amountCents);
    revalidateBillViews();
    return { paid };
  },
);
