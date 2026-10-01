import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/lib/api/errors";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { getSessionUser } from "@/lib/auth/session";
import { accountDetail, listConnections } from "@/lib/accounts/service";
import { isEnabled } from "@/lib/flags";
import { listTransactions } from "@/lib/transactions/service";
import { transactionFiltersSchema } from "@/lib/transactions/schemas";
import { AccountDetail, type RecentTransaction } from "@/components/accounts/account-detail";

type Params = Promise<{ id: string }>;

const isUuid = (id: string) => z.string().uuid().safeParse(id).success;

/** Account, ~1 year of balance history and 90-day flows. Null for unknown ids or other users' accounts. */
const loadDetail = cache(async (userId: string, id: string, timeZone: string) => {
  if (!isUuid(id)) return null;
  try {
    return await accountDetail(userId, id, timeZone);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") return null;
    throw err;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getSessionUser()]);
  const detail = user ? await loadDetail(user.id, id, user.timeZone) : null;
  return { title: detail?.account.name ?? "Account" };
}

export default async function AccountPage({ params }: { params: Params }) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  const detail = await loadDetail(user.id, id, user.timeZone);
  if (!detail) notFound();

  const { account, history, last90 } = detail;
  const [transactions, connections] = await Promise.all([
    listTransactions(user.id, transactionFiltersSchema.parse({ accountId: account.id, pageSize: 10 })),
    account.connection ? listConnections(user.id) : Promise.resolve([]),
  ]);
  const connection = connections.find((c) => c.id === account.connection?.id) ?? null;
  const recent: RecentTransaction[] = transactions.rows.map((t) => ({
    id: t.id,
    date: t.date,
    merchantName: t.merchantName,
    amountCents: t.amountCents,
    currency: t.currency,
    isPending: t.isPending,
    isTransfer: t.isTransfer,
    category: t.category ? { name: t.category.name, icon: t.category.icon, color: t.category.color } : null,
  }));

  return (
    <AccountDetail
      key={account.id}
      account={account}
      history={history}
      last90={last90}
      recent={recent}
      transactionCount={transactions.total}
      connection={connection}
      csvEnabled={isEnabled("ENABLE_CSV_IMPORT")}
      now={new Date().toISOString()}
    />
  );
}
