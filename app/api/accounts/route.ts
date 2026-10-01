import { z } from "zod";
import { apiRoute, json } from "@/lib/api/route";
import { createManualAccount, getAccount, listAccounts } from "@/lib/accounts/service";
import { manualAccountSchema } from "@/lib/accounts/schemas";
import { revalidateAccountViews } from "@/lib/accounts/revalidate";

export const dynamic = "force-dynamic";

/** GET /api/accounts[?hidden=1] — the signed-in user's accounts (hidden ones only when asked). */
export const GET = apiRoute({ query: z.object({ hidden: z.enum(["0", "1", "true", "false"]).optional() }) }, async ({ user, query }) =>
  listAccounts(user.id, { includeHidden: query.hidden === "1" || query.hidden === "true" }),
);

/** POST /api/accounts — creates a manual account. Body: see manualAccountSchema (amounts in cents). */
export const POST = apiRoute({ body: manualAccountSchema }, async ({ user, body }) => {
  const account = await createManualAccount(user.id, body);
  revalidateAccountViews();
  return json(await getAccount(user.id, account.id), { status: 201 });
});
