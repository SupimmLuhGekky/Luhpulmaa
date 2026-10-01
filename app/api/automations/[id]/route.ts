import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { AppError, notFound } from "@/lib/api/errors";
import { isEnabled } from "@/lib/flags";
import { automationInputSchema } from "@/lib/automation/schemas";
import { deleteAutomation, getAutomation, listRuns, setAutomationActive, updateAutomation } from "@/lib/automation/service";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** Validates the feature flag and the id; ownership is checked by every service call. */
function automationId(params: Params): string {
  if (!isEnabled("ENABLE_AUTOMATIONS")) throw new AppError("FEATURE_DISABLED", "Automations are turned off on this server.");
  const parsed = z.string().uuid().safeParse(params.id);
  if (!parsed.success) throw notFound("Automation");
  return parsed.data;
}

/** GET /api/automations/:id — the automation and its 20 most recent runs. */
export const GET = apiRoute<Params>({ rateLimitKey: "automations" }, async ({ user, params }) => {
  const id = automationId(params);
  const [automation, runs] = await Promise.all([getAutomation(user.id, id), listRuns(user.id, { automationId: id, take: 20 })]);
  return { ...automation, recentRuns: runs.items };
});

/** PATCH /api/automations/:id — `{ isActive }` to switch it on/off, or a full automation to replace it. */
export const PATCH = apiRoute<Params, z.ZodTypeAny>(
  { body: z.union([z.object({ isActive: z.boolean() }).strict(), automationInputSchema]), rateLimitKey: "automations" },
  async ({ user, params, body }) => {
    const id = automationId(params);
    const input = body as { isActive: boolean } | z.infer<typeof automationInputSchema>;
    if ("trigger" in input) return updateAutomation(user.id, id, input);
    await setAutomationActive(user.id, id, input.isActive);
    return getAutomation(user.id, id);
  },
);

/** DELETE /api/automations/:id — deletes the automation and its run history. Planned allocations it recorded stay on the goals. */
export const DELETE = apiRoute<Params>({ rateLimitKey: "automations" }, async ({ user, params }) => {
  await deleteAutomation(user.id, automationId(params));
  return { deleted: true };
});
