import { apiRoute } from "@/lib/api/route";
import { previewLunchFlow } from "@/lib/accounts/lunchflow";
import { lunchFlowPreviewSchema } from "@/lib/accounts/schemas";
import { withProviderErrors } from "@/lib/accounts/errors";
import { enforceSyncLimit } from "@/lib/accounts/limits";

export const dynamic = "force-dynamic";

/** POST /api/accounts/lunchflow/preview — `{ apiKey }`. Lists what the key can read; saves nothing. */
export const POST = apiRoute({ body: lunchFlowPreviewSchema }, async ({ user, body }) => {
  await enforceSyncLimit("link", user.id);
  return withProviderErrors(() => previewLunchFlow(user, body.apiKey));
});
