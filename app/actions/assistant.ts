"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { isEnabled } from "@/lib/flags";
import { updatePreferences } from "@/lib/users/service";

/** Turns the optional AI features on or off for the signed-in user. */
export const setAssistantOptInAction = authedAction(z.object({ optIn: z.boolean() }), async ({ optIn }, user) => {
  if (optIn && !isEnabled("ENABLE_AI_ASSISTANT")) throw new AppError("FEATURE_DISABLED", "The assistant is turned off on this server.");
  await updatePreferences(user.id, { aiOptIn: optIn });
  revalidatePath("/assistant");
  revalidatePath("/settings/privacy");
  return { optIn };
});
