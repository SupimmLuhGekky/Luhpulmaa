import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { updateTransactionSchema } from "@/lib/transactions/schemas";
import { deleteTransaction, getTransaction, updateTransaction } from "@/lib/transactions/service";

type Params = { id: string };
const id = z.string().uuid();

function parseId(raw: string) {
  const parsed = id.safeParse(raw);
  if (!parsed.success) throw new AppError("NOT_FOUND", "Transaction not found.");
  return parsed.data;
}

export const GET = apiRoute<Params>({}, async ({ user, params }) => getTransaction(user.id, parseId(params.id)));

export const PATCH = apiRoute<Params, typeof updateTransactionSchema>({ body: updateTransactionSchema }, async ({ user, params, body }) => updateTransaction(user.id, parseId(params.id), body));

export const DELETE = apiRoute<Params>({}, async ({ user, params }) => {
  await deleteTransaction(user.id, parseId(params.id));
  return { deleted: true };
});
