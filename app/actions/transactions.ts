"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { createTransactionSchema, transactionFiltersSchema, updateTransactionSchema } from "@/lib/transactions/schemas";
import { bulkUpdateCategory, createManualTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction } from "@/lib/transactions/service";
import { listTags } from "@/lib/transactions/service";

const id = z.string().uuid();

/** Pages that show transaction-derived numbers and must refresh after a change. */
function revalidateMoneyViews() {
  for (const path of ["/dashboard", "/transactions", "/accounts", "/budget", "/analytics", "/goals", "/forecast", "/net-worth"]) revalidatePath(path);
}

export const createTransactionAction = authedAction(createTransactionSchema, async (input, user) => {
  const tx = await createManualTransaction(user.id, input);
  revalidateMoneyViews();
  return tx;
});

export const updateTransactionAction = authedAction(z.object({ id, patch: updateTransactionSchema }), async ({ id: txId, patch }, user) => {
  const res = await updateTransaction(user.id, txId, patch);
  revalidateMoneyViews();
  return res;
});

export const deleteTransactionAction = authedAction(z.object({ id }), async ({ id: txId }, user) => {
  await deleteTransaction(user.id, txId);
  revalidateMoneyViews();
  return { deleted: true };
});

export const bulkCategorizeAction = authedAction(z.object({ ids: z.array(id).min(1).max(500), categoryId: id.nullable() }), async ({ ids, categoryId }, user) => {
  const count = await bulkUpdateCategory(user.id, ids, categoryId);
  revalidateMoneyViews();
  return { count };
});

export const getTransactionAction = authedAction(z.object({ id }), async ({ id: txId }, user) => getTransaction(user.id, txId));

export const listTransactionsAction = authedAction(transactionFiltersSchema, async (filters, user) => listTransactions(user.id, filters));

export const listTagsAction = authedAction(z.object({}), async (_input, user) => listTags(user.id));
