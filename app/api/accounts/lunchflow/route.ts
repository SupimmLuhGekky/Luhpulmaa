import { apiRoute } from "@/lib/api/route";
import { connectLunchFlow } from "@/lib/accounts/lunchflow";
import { lunchFlowConnectSchema } from "@/lib/accounts/schemas";
import { withProviderErrors } from "@/lib/accounts/errors";
import { enforceSyncLimit } from "@/lib/accounts/limits";
import { revalidateAccountViews } from "@/lib/accounts/revalidate";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/lunchflow — `{ apiKey, accounts: [{ providerAccountId, action, type?, linkAccountId? }] }`.
 * Saves the person's Lunch Flow key (encrypted) and runs the first import. Shares the sync rate limit.
 */
export const POST = apiRoute({ body: lunchFlowConnectSchema }, async ({ user, body }) => {
  await enforceSyncLimit("sync", user.id);
  const result = await withProviderErrors(() => connectLunchFlow(user, body.apiKey, body.accounts));
  revalidateAccountViews();
  return result;
});
