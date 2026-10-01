import { json, apiRoute } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { isEnabled } from "@/lib/flags";
import { automationInputSchema } from "@/lib/automation/schemas";
import { createAutomation, listAutomations } from "@/lib/automation/service";

export const dynamic = "force-dynamic";

function assertEnabled() {
  if (!isEnabled("ENABLE_AUTOMATIONS")) throw new AppError("FEATURE_DISABLED", "Automations are turned off on this server.");
}

/** GET /api/automations — the signed-in user's automations. */
export const GET = apiRoute({ rateLimitKey: "automations" }, async ({ user }) => {
  assertEnabled();
  return listAutomations(user.id);
});

/** POST /api/automations — create an automation (same validation as the builder). */
export const POST = apiRoute({ body: automationInputSchema, rateLimitKey: "automations" }, async ({ user, body }) => {
  assertEnabled();
  return json(await createAutomation(user.id, body), { status: 201 });
});
