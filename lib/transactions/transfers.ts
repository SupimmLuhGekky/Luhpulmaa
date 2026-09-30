import "server-only";
import { prisma } from "@/lib/db/prisma";
import { daysBetween, fromDbDate, toDbDate, type LocalDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";

/**
 * Pairs opposite-signed transactions of equal size between two of the user's own
 * accounts within 4 days (e.g. "Transfer to savings" −$200 and "Transfer from
 * chequing" +$200, or a card payment) and marks both as transfers so they don't
 * inflate income or spending. Never touches rows the user categorised themselves.
 */
export async function matchTransfers(userId: string, since: LocalDate) {
  const txns = await prisma.transaction.findMany({
    where: { userId, date: { gte: toDbDate(since) }, isExcluded: false, categorizedBy: { not: "USER" } },
    select: { id: true, accountId: true, amountCents: true, date: true, isTransfer: true },
    orderBy: { date: "asc" },
  });
  const transferCat = await prisma.category.findFirst({ where: { userId, systemKey: "transfers" }, select: { id: true } });
  const outflows = txns.filter((t) => toCents(t.amountCents) < 0);
  const inflows = txns.filter((t) => toCents(t.amountCents) > 0);
  const used = new Set<string>();
  const pairs: [string, string][] = [];
  for (const out of outflows) {
    const amount = -toCents(out.amountCents);
    const match = inflows.find(
      (i) => !used.has(i.id) && i.accountId !== out.accountId && toCents(i.amountCents) === amount && Math.abs(daysBetween(fromDbDate(out.date), fromDbDate(i.date))) <= 4 && (out.isTransfer || i.isTransfer),
    );
    if (match) {
      used.add(match.id);
      pairs.push([out.id, match.id]);
    }
  }
  const ids = pairs.flat();
  if (ids.length) {
    await prisma.transaction.updateMany({
      where: { userId, id: { in: ids } },
      data: { isTransfer: true, type: "TRANSFER", ...(transferCat ? { categoryId: transferCat.id, subcategoryId: null, categorizedBy: "SYSTEM_RULE", categorizedByLabel: "Matched transfer between your accounts" } : {}) },
    });
  }
  return pairs.length;
}
