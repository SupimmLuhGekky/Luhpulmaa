import { apiRoute } from "@/lib/api/route";
import { syncAccount } from "@/lib/accounts/service";
import { syncAccountSchema } from "@/lib/accounts/schemas";
import { withProviderErrors } from "@/lib/accounts/errors";
import { enforceSyncLimit } from "@/lib/accounts/limits";
import { revalidateAccountViews } from "@/lib/accounts/revalidate";

export const dynamic = "force-dynamic";

/** POST /api/accounts/sync — `{ accountId }`. Refreshes the account's whole bank connection. */
export const POST = apiRoute({ body: syncAccountSchema }, async ({ user, body }) => {
  await enforceSyncLimit("sync", user.id);
  const outcome = await withProviderErrors(() => syncAccount(user.id, body.accountId));
  revalidateAccountViews();
  return outcome;
});
