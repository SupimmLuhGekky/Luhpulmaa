import { apiRoute } from "@/lib/api/route";
import { completeConnection } from "@/lib/accounts/service";
import { connectSchema } from "@/lib/accounts/schemas";
import { withProviderErrors } from "@/lib/accounts/errors";
import { enforceSyncLimit } from "@/lib/accounts/limits";
import { revalidateAccountViews } from "@/lib/accounts/revalidate";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/connect — `{ publicToken, metadata? }` from the provider widget.
 * Stores the (encrypted) access token and runs the first import. Shares the sync rate limit.
 */
export const POST = apiRoute({ body: connectSchema }, async ({ user, body }) => {
  await enforceSyncLimit("sync", user.id);
  const result = await withProviderErrors(() => completeConnection(user.id, body.publicToken, body.metadata));
  revalidateAccountViews();
  return result;
});
