import "server-only";
import { prisma } from "@/lib/db/prisma";
import { fromDbDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { notify } from "@/lib/notifications/service";
import { notificationFormat } from "@/lib/notifications/format";
import { userPreferences } from "@/lib/settings/preferences";

/** Notifies about new outflows above the user's large-transaction threshold. */
export async function notifyLargeTransactions(userId: string, transactionIds: string[]) {
  const prefs = await userPreferences(userId);
  const threshold = prefs.largeTransactionCents;
  if (!threshold) return;
  const txns = await prisma.transaction.findMany({
    where: { userId, id: { in: transactionIds }, isTransfer: false, amountCents: { lte: -threshold } },
    select: { id: true, merchantName: true, description: true, amountCents: true, date: true },
    take: 20,
  });
  const f = await notificationFormat(userId);
  for (const t of txns) {
    await notify(userId, {
      type: "LARGE_TRANSACTION",
      severity: "INFO",
      title: `Large transaction: ${f.money(-toCents(t.amountCents))}`,
      body: `${t.merchantName || t.description} on ${f.date(fromDbDate(t.date))}.`,
      href: `/transactions?txn=${t.id}`,
      dedupeKey: `large:${t.id}`,
    });
  }
}
