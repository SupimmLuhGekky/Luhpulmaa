"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { createSubscription, deleteSubscription, subscriptionFromRecurring, subscriptionInputSchema, unmarkSubscription, updateSubscription } from "@/lib/subscriptions/service";

const id = z.string().uuid();

/** Pages whose numbers include subscriptions. */
function revalidateSubscriptionViews() {
  for (const path of ["/subscriptions", "/bills", "/forecast", "/analytics", "/dashboard"]) revalidatePath(path);
}

export const createSubscriptionAction = authedAction(subscriptionInputSchema, async (input, user) => {
  const sub = await createSubscription(user.id, input);
  revalidateSubscriptionViews();
  return { id: sub.id };
});

export const updateSubscriptionAction = authedAction(z.object({ id, patch: subscriptionInputSchema.partial() }), async ({ id: subId, patch }, user) => {
  await updateSubscription(user.id, subId, patch);
  revalidateSubscriptionViews();
  return { id: subId };
});

export const deleteSubscriptionAction = authedAction(z.object({ id }), async ({ id: subId }, user) => {
  await deleteSubscription(user.id, subId);
  revalidateSubscriptionViews();
  return { deleted: true };
});

/** Turns a detected recurring charge into a subscription. */
export const markRecurringAsSubscriptionAction = authedAction(z.object({ recurringId: id }), async ({ recurringId }, user) => {
  const sub = await subscriptionFromRecurring(user.id, recurringId);
  revalidateSubscriptionViews();
  return { id: sub.id };
});

/** "Not a subscription": keeps the recurring charge, removes the subscription. */
export const unmarkSubscriptionAction = authedAction(z.object({ id }), async ({ id: subId }, user) => {
  const res = await unmarkSubscription(user.id, subId);
  revalidateSubscriptionViews();
  return res;
});
