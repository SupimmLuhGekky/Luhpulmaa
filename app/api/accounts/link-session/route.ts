import { apiRoute } from "@/lib/api/route";
import { createLinkSession } from "@/lib/accounts/service";
import { linkSessionSchema } from "@/lib/accounts/schemas";
import { withProviderErrors } from "@/lib/accounts/errors";
import { enforceSyncLimit } from "@/lib/accounts/limits";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/link-session — body `{}` or `{ reconnectConnectionId }`.
 * Returns how to open the provider's hosted sign-in (Plaid link token or Flinks Connect URL).
 */
export const POST = apiRoute({ body: linkSessionSchema }, async ({ user, body }) => {
  await enforceSyncLimit("link", user.id);
  return withProviderErrors(() => createLinkSession(user.id, body.reconnectConnectionId));
});
