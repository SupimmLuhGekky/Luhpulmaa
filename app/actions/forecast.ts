"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { updatePreferences, updateProfile } from "@/lib/users/service";

/** Pages that show safe-to-spend or the cash buffer. */
function revalidateCashViews() {
  for (const path of ["/forecast", "/dashboard", "/settings"]) revalidatePath(path);
}

/** The minimum cash buffer that safe-to-spend never counts as spendable. */
export const updateCashBufferAction = authedAction(z.object({ minCashBufferCents: z.number().int().min(0).max(100_000_000) }), async ({ minCashBufferCents }, user) => {
  await updateProfile(user.id, { minCashBufferCents });
  revalidateCashViews();
  return { minCashBufferCents };
});

/** Whether savings accounts count as spendable cash in safe-to-spend and the forecast. */
export const setIncludeSavingsAction = authedAction(z.object({ include: z.boolean() }), async ({ include }, user) => {
  await updatePreferences(user.id, { includeSavingsInSafeToSpend: include });
  revalidateCashViews();
  return { include };
});
