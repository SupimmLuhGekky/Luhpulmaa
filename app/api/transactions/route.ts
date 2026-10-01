import { apiRoute } from "@/lib/api/route";
import { createTransactionSchema } from "@/lib/transactions/schemas";
import { createManualTransaction, listTransactions } from "@/lib/transactions/service";
import { filtersFromSearchParams } from "@/lib/transactions/url";

/**
 * GET  /api/transactions?q=&account=&category=&from=&to=&type=&page=… (same parameters as the page)
 * POST /api/transactions  { accountId, date, amountCents, merchantName, … }  → manual transaction
 */
export const GET = apiRoute({}, async ({ req, user }) => listTransactions(user.id, filtersFromSearchParams(req.nextUrl.searchParams)));

export const POST = apiRoute({ body: createTransactionSchema }, async ({ user, body }) => createManualTransaction(user.id, body));

