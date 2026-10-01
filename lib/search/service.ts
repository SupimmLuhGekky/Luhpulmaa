import "server-only";
import { prisma } from "@/lib/db/prisma";
import { fromDbDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";

export interface SearchResult {
  type: "transaction" | "account" | "category" | "goal" | "bill" | "subscription" | "merchant";
  id: string;
  title: string;
  subtitle?: string;
  amountCents?: number;
  href: string;
}

/** Global search across the signed-in user's own records only. */
export async function globalSearch(userId: string, rawQuery: string): Promise<Record<SearchResult["type"], SearchResult[]>> {
  const q = rawQuery.trim().slice(0, 80);
  const empty = { transaction: [], account: [], category: [], goal: [], bill: [], subscription: [], merchant: [] };
  if (q.length < 2) return empty;
  const contains = { contains: q, mode: "insensitive" as const };
  const [transactions, accounts, categories, goals, bills, subs] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, OR: [{ merchantName: contains }, { description: contains }, { notes: contains }] },
      select: { id: true, merchantName: true, description: true, amountCents: true, date: true, account: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 8,
    }),
    prisma.account.findMany({ where: { userId, OR: [{ name: contains }, { officialName: contains }] }, select: { id: true, name: true, type: true, currentBalanceCents: true }, take: 5 }),
    prisma.category.findMany({ where: { userId, name: contains }, select: { id: true, name: true, kind: true }, take: 5 }),
    prisma.goal.findMany({ where: { userId, name: contains }, select: { id: true, name: true, currentCents: true, targetCents: true }, take: 5 }),
    prisma.bill.findMany({ where: { userId, name: contains }, select: { id: true, name: true, amountCents: true }, take: 5 }),
    prisma.subscription.findMany({ where: { userId, name: contains }, select: { id: true, name: true, amountCents: true }, take: 5 }),
  ]);
  return {
    transaction: transactions.map((t) => ({ type: "transaction", id: t.id, title: t.merchantName ?? t.description, subtitle: `${fromDbDate(t.date)} · ${t.account.name}`, amountCents: toCents(t.amountCents), href: `/transactions?txn=${t.id}` })),
    account: accounts.map((a) => ({ type: "account", id: a.id, title: a.name, subtitle: a.type.replace("_", " ").toLowerCase(), amountCents: toCents(a.currentBalanceCents), href: `/accounts/${a.id}` })),
    category: categories.map((c) => ({ type: "category", id: c.id, title: c.name, subtitle: "Category", href: `/transactions?category=${c.id}` })),
    goal: goals.map((g) => ({ type: "goal", id: g.id, title: g.name, subtitle: "Goal", amountCents: toCents(g.currentCents), href: `/goals/${g.id}` })),
    bill: bills.map((b) => ({ type: "bill", id: b.id, title: b.name, subtitle: "Bill", amountCents: toCents(b.amountCents), href: "/bills" })),
    subscription: subs.map((s) => ({ type: "subscription", id: s.id, title: s.name, subtitle: "Subscription", amountCents: toCents(s.amountCents), href: "/subscriptions" })),
    merchant: [],
  };
}
