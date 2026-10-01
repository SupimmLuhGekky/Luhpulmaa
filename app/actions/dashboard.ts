"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { saveLayout } from "@/lib/dashboard/service";
import { dashboardLayoutSchema, resolveLayout } from "@/lib/dashboard/layout";

/** Saves which dashboard widgets are shown and in what order; `layout: null` restores the default. */
export const saveDashboardLayoutAction = authedAction(z.object({ layout: dashboardLayoutSchema.nullable() }), async ({ layout }, user) => {
  await saveLayout(user.id, layout ? resolveLayout(layout) : null);
  revalidatePath("/dashboard");
  return { saved: true };
});
