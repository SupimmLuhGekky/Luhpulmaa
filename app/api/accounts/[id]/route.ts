import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { notFound } from "@/lib/api/errors";
import { accountDetail, deleteManualAccount, getAccount, updateAccount } from "@/lib/accounts/service";
import { accountUpdateSchema } from "@/lib/accounts/schemas";
import { revalidateAccountViews } from "@/lib/accounts/revalidate";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** Malformed ids are simply "not found" (and never reach the database). */
function accountId(params: Params): string {
  const parsed = z.string().uuid().safeParse(params.id);
  if (!parsed.success) throw notFound("Account");
  return parsed.data;
}

/** GET /api/accounts/:id — the account, ~1 year of balance history and the last 90 days of activity. */
export const GET = apiRoute<Params>({}, async ({ user, params }) => accountDetail(user.id, accountId(params), user.timeZone));

/** PATCH /api/accounts/:id — rename, hide, include in net worth; manual accounts also balance, type and credit limit. */
export const PATCH = apiRoute<Params, typeof accountUpdateSchema>({ body: accountUpdateSchema }, async ({ user, params, body }) => {
  const id = accountId(params);
  await updateAccount(user.id, id, body);
  revalidateAccountViews();
  return getAccount(user.id, id);
});

/** DELETE /api/accounts/:id — deletes a manual account and all of its transactions. */
export const DELETE = apiRoute<Params>({}, async ({ user, params }) => {
  await deleteManualAccount(user.id, accountId(params));
  revalidateAccountViews();
  return { deleted: true };
});
