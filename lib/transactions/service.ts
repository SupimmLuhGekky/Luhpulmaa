import "server-only";
import type { AccountType, Prisma, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { fromDbDate, todayIn, toDbDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { recordNetWorthSnapshot } from "@/lib/networth/service";
import { LEARNING_THRESHOLD } from "./categorization";
import { ingestTransactions } from "./ingest";
import { normalizeMerchant } from "./normalize";
import type { TransactionFilters } from "./schemas";
import type { z } from "zod";
import type { createTransactionSchema, updateTransactionSchema } from "./schemas";

const LIABILITY_TYPES = new Set(["CREDIT_CARD", "LINE_OF_CREDIT", "LOAN", "MORTGAGE", "OTHER_LIABILITY"]);

/**
 * Moves a manual account's balance by a transaction's effect and keeps today's balance
 * history and net worth in step. (Connected accounts' balances come from the bank.)
 */
async function moveManualBalance(userId: string, account: { id: string; type: AccountType }, deltaCents: number) {
  if (deltaCents === 0) return;
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { currentBalanceCents: { increment: LIABILITY_TYPES.has(account.type) ? -deltaCents : deltaCents } },
    select: { currentBalanceCents: true },
  });
  const { timeZone } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const today = todayIn(timeZone);
  const balanceCents = toCents(updated.currentBalanceCents);
  await prisma.accountBalanceSnapshot.upsert({
    where: { accountId_date: { accountId: account.id, date: toDbDate(today) } },
    update: { balanceCents },
    create: { userId, accountId: account.id, date: toDbDate(today), balanceCents },
  });
  await recordNetWorthSnapshot(userId, today);
}

export const transactionListSelect = {
  id: true,
  date: true,
  postedDate: true,
  merchantName: true,
  description: true,
  amountCents: true,
  currency: true,
  type: true,
  isPending: true,
  isRecurring: true,
  isTransfer: true,
  isManual: true,
  isExcluded: true,
  notes: true,
  categorizedBy: true,
  categorizedByLabel: true,
  account: { select: { id: true, name: true, type: true, mask: true } },
  category: { select: { id: true, name: true, icon: true, color: true, kind: true } },
  subcategory: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.TransactionSelect;

export type TransactionListRow = Prisma.TransactionGetPayload<{ select: typeof transactionListSelect }>;

/** Plain-JSON shape sent to client components. */
export interface TransactionDTO {
  id: string;
  date: string;
  postedDate: string | null;
  merchantName: string;
  description: string;
  amountCents: number;
  currency: string;
  type: TransactionType;
  isPending: boolean;
  isRecurring: boolean;
  isTransfer: boolean;
  isManual: boolean;
  isExcluded: boolean;
  notes: string | null;
  categorizedBy: string;
  categorizedByLabel: string | null;
  account: { id: string; name: string; type: string; mask: string | null };
  category: { id: string; name: string; icon: string; color: string; kind: string } | null;
  subcategory: { id: string; name: string } | null;
  tags: { id: string; name: string; color: string }[];
}

export function toTransactionDTO(t: TransactionListRow): TransactionDTO {
  return {
    id: t.id,
    date: fromDbDate(t.date),
    postedDate: fromDbDate(t.postedDate),
    merchantName: t.merchantName ?? t.description,
    description: t.description,
    amountCents: toCents(t.amountCents),
    currency: t.currency,
    type: t.type,
    isPending: t.isPending,
    isRecurring: t.isRecurring,
    isTransfer: t.isTransfer,
    isManual: t.isManual,
    isExcluded: t.isExcluded,
    notes: t.notes,
    categorizedBy: t.categorizedBy,
    categorizedByLabel: t.categorizedByLabel,
    account: t.account,
    category: t.category,
    subcategory: t.subcategory,
    tags: t.tags.map((x) => x.tag),
  };
}

export function buildTransactionWhere(userId: string, f: Partial<TransactionFilters>): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { userId };
  const and: Prisma.TransactionWhereInput[] = [];
  if (f.q) {
    and.push({
      OR: [
        { merchantName: { contains: f.q, mode: "insensitive" } },
        { description: { contains: f.q, mode: "insensitive" } },
        { notes: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  if (f.accountId) where.accountId = Array.isArray(f.accountId) ? { in: f.accountId } : f.accountId;
  if (f.categoryId) {
    const ids = Array.isArray(f.categoryId) ? f.categoryId : [f.categoryId];
    const real = ids.filter((i) => i !== "uncategorized");
    const or: Prisma.TransactionWhereInput[] = [];
    if (real.length) or.push({ categoryId: { in: real } });
    if (ids.includes("uncategorized")) or.push({ categoryId: null });
    and.push({ OR: or });
  }
  if (f.merchantId) where.merchantId = f.merchantId;
  if (f.type) where.type = f.type;
  if (f.tagId) where.tags = { some: { tagId: f.tagId } };
  if (f.from || f.to) where.date = { ...(f.from ? { gte: toDbDate(f.from) } : {}), ...(f.to ? { lte: toDbDate(f.to) } : {}) };
  if (f.minCents !== undefined || f.maxCents !== undefined) {
    // Amount filters apply to the absolute value.
    const min = f.minCents ?? 0;
    const max = f.maxCents ?? Number.MAX_SAFE_INTEGER;
    and.push({ OR: [{ amountCents: { gte: min, lte: max } }, { amountCents: { gte: -max, lte: -min } }] });
  }
  if (f.pending) where.isPending = f.pending === "true";
  if (f.review === "uncategorized") where.categoryId = null;
  if (f.review === "ai") where.categorizedBy = "AI";
  if (and.length) where.AND = and;
  return where;
}

const SORTS: Record<TransactionFilters["sort"], Prisma.TransactionOrderByWithRelationInput[]> = {
  date_desc: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  date_asc: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  amount_desc: [{ amountCents: "desc" }, { id: "desc" }],
  amount_asc: [{ amountCents: "asc" }, { id: "asc" }],
  merchant_asc: [{ merchantName: "asc" }, { date: "desc" }],
};

/** Server-side paginated listing. Never loads more than `pageSize` rows. */
export async function listTransactions(userId: string, filters: TransactionFilters) {
  const where = buildTransactionWhere(userId, filters);
  const [rows, total, sums] = await Promise.all([
    prisma.transaction.findMany({
      where,
      select: transactionListSelect,
      orderBy: SORTS[filters.sort],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.groupBy({ by: ["type"], where: { ...where, isExcluded: false }, _sum: { amountCents: true } }),
  ]);
  const totals = { inflow: 0, outflow: 0 };
  for (const s of sums) {
    const v = toCents(s._sum.amountCents);
    if (s.type === "TRANSFER") continue;
    if (v >= 0) totals.inflow += v;
    else totals.outflow += -v;
  }
  return { rows: rows.map(toTransactionDTO), total, page: filters.page, pageSize: filters.pageSize, pageCount: Math.max(1, Math.ceil(total / filters.pageSize)), totals };
}

export async function getTransaction(userId: string, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, userId }, select: { ...transactionListSelect, automationRuns: { select: { automation: { select: { id: true, name: true } }, summary: true, executedAt: true, status: true } }, contributions: { select: { id: true, amountCents: true, kind: true, goal: { select: { id: true, name: true } } } } } });
  if (!t) throw notFound("Transaction");
  return {
    ...toTransactionDTO(t),
    automationRuns: t.automationRuns.map((r) => ({ ...r, executedAt: r.executedAt.toISOString() })),
    contributions: t.contributions.map((c) => ({ id: c.id, amountCents: toCents(c.amountCents), kind: c.kind, goal: c.goal })),
  };
}

async function setTags(userId: string, transactionId: string, names: string[]) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const tags = await Promise.all(unique.map((name) => prisma.tag.upsert({ where: { userId_name: { userId, name } }, update: {}, create: { userId, name } })));
  await prisma.$transaction([
    prisma.transactionTag.deleteMany({ where: { transactionId, tagId: { notIn: tags.map((t) => t.id) } } }),
    ...tags.map((t) => prisma.transactionTag.upsert({ where: { transactionId_tagId: { transactionId, tagId: t.id } }, update: {}, create: { transactionId, tagId: t.id } })),
  ]);
}

async function assertCategory(userId: string, categoryId: string | null | undefined, subcategoryId?: string | null) {
  if (!categoryId) return null;
  const cat = await prisma.category.findFirst({ where: { id: categoryId, userId }, include: { subcategories: { select: { id: true } } } });
  if (!cat) throw notFound("Category");
  if (subcategoryId && !cat.subcategories.some((s) => s.id === subcategoryId)) throw new AppError("VALIDATION_FAILED", "That subcategory doesn't belong to the category.");
  return cat;
}

export async function createManualTransaction(userId: string, input: z.infer<typeof createTransactionSchema>) {
  const account = await prisma.account.findFirst({ where: { id: input.accountId, userId }, select: { id: true } });
  if (!account) throw notFound("Account");
  await assertCategory(userId, input.categoryId, input.subcategoryId);
  const res = await ingestTransactions(
    userId,
    [
      {
        accountId: input.accountId,
        date: input.date,
        amountCents: input.amountCents,
        description: input.description || input.merchantName,
        merchantName: input.merchantName,
        categoryId: input.categoryId ?? null,
        subcategoryId: input.subcategoryId ?? null,
        notes: input.notes ?? null,
        isManual: true,
      },
    ],
    { runAutomations: true },
  );
  // Manual entries are deliberate: never silently drop them as fuzzy duplicates.
  let id = res.created[0];
  if (!id) {
    const retry = await prisma.transaction.create({
      data: {
        userId,
        accountId: input.accountId,
        date: toDbDate(input.date),
        amountCents: input.amountCents,
        description: input.description || input.merchantName,
        merchantName: input.merchantName,
        categoryId: input.categoryId ?? null,
        subcategoryId: input.subcategoryId ?? null,
        categorizedBy: input.categoryId ? "USER" : "UNCATEGORIZED",
        type: input.amountCents > 0 ? "INCOME" : "EXPENSE",
        notes: input.notes ?? null,
        isManual: true,
        fingerprint: `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      },
    });
    id = retry.id;
  }
  if (input.tags?.length) await setTags(userId, id, input.tags);
  // Manual transactions on manual accounts move the balance; connected balances come from the bank.
  const acct = await prisma.account.findUniqueOrThrow({ where: { id: input.accountId }, select: { id: true, isManual: true, type: true } });
  if (acct.isManual) await moveManualBalance(userId, acct, input.amountCents);
  await audit(userId, "transaction.created", { type: "transaction", id }, { manual: true });
  return getTransaction(userId, id);
}

/**
 * Records a category correction and learns merchant preferences: after
 * LEARNING_THRESHOLD corrections of the same merchant to the same category, a
 * MerchantRule becomes active and future imports use it.
 */
async function learnFromCorrection(userId: string, merchantKey: string, merchantId: string | null, categoryId: string, subcategoryId: string | null) {
  if (!merchantKey) return null;
  const rule = await prisma.merchantRule.upsert({
    where: { userId_pattern_categoryId: { userId, pattern: merchantKey, categoryId } },
    update: { correctionCount: { increment: 1 }, subcategoryId },
    create: { userId, pattern: merchantKey, categoryId, subcategoryId, merchantId, source: "USER_CORRECTION", correctionCount: 1 },
  });
  if (rule.source === "USER_CORRECTION" && rule.correctionCount >= LEARNING_THRESHOLD && !rule.isActive) {
    await prisma.$transaction([
      prisma.merchantRule.updateMany({ where: { userId, pattern: merchantKey, id: { not: rule.id }, source: "USER_CORRECTION" }, data: { isActive: false } }),
      prisma.merchantRule.update({ where: { id: rule.id }, data: { isActive: true } }),
    ]);
    return { learned: true, ruleId: rule.id };
  }
  return { learned: rule.isActive, ruleId: rule.id };
}

export async function updateTransaction(userId: string, id: string, input: z.infer<typeof updateTransactionSchema>) {
  const existing = await prisma.transaction.findFirst({ where: { id, userId }, select: { id: true, isManual: true, categoryId: true, merchantName: true, description: true, merchantId: true, amountCents: true, accountId: true } });
  if (!existing) throw notFound("Transaction");
  const data: Prisma.TransactionUncheckedUpdateInput = {};
  let learned: { learned: boolean; ruleId: string } | null = null;
  let appliedToOthers = 0;

  if (input.categoryId !== undefined) {
    const cat = await assertCategory(userId, input.categoryId, input.subcategoryId);
    data.categoryId = input.categoryId;
    data.subcategoryId = input.subcategoryId ?? null;
    data.categorizedBy = input.categoryId ? "USER" : "UNCATEGORIZED";
    data.categorizedByRuleId = null;
    data.categorizedByLabel = input.categoryId ? "Changed by you" : null;
    if (cat?.kind === "TRANSFER") {
      data.isTransfer = true;
      data.type = "TRANSFER";
    } else if (cat) {
      const amount = toCents(existing.amountCents);
      data.isTransfer = false;
      data.type = cat.kind === "INCOME" ? (amount > 0 ? "INCOME" : "EXPENSE") : amount > 0 ? "REFUND" : "EXPENSE";
    }
    if (input.categoryId && input.categoryId !== existing.categoryId) {
      const key = normalizeMerchant(existing.merchantName || existing.description);
      learned = await learnFromCorrection(userId, key, existing.merchantId, input.categoryId, input.subcategoryId ?? null);
      if (input.applyToMerchant && existing.merchantId) {
        const res = await prisma.transaction.updateMany({
          where: { userId, merchantId: existing.merchantId, id: { not: id }, categorizedBy: { not: "USER" } },
          data: { categoryId: input.categoryId, subcategoryId: input.subcategoryId ?? null, categorizedBy: "MERCHANT_RULE", categorizedByRuleId: learned?.ruleId ?? null, categorizedByLabel: "Applied from your change" },
        });
        appliedToOthers = res.count;
      }
    }
  }
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.type !== undefined) data.type = input.type;
  if (input.isRecurring !== undefined) data.isRecurring = input.isRecurring;
  if (input.isTransfer !== undefined) {
    data.isTransfer = input.isTransfer;
    if (input.isTransfer) data.type = "TRANSFER";
    else if (input.type === undefined) data.type = toCents(existing.amountCents) > 0 ? "INCOME" : "EXPENSE";
  }
  if (input.isExcluded !== undefined) data.isExcluded = input.isExcluded;
  if (input.merchantName !== undefined) data.merchantName = input.merchantName;
  if (input.date !== undefined || input.amountCents !== undefined) {
    if (!existing.isManual) throw new AppError("FORBIDDEN", "Date and amount of imported transactions come from your bank and can't be edited.");
    if (input.date) data.date = toDbDate(input.date);
    if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  }
  await prisma.transaction.update({ where: { id }, data });
  // A corrected amount on a manual transaction moves a manual account's balance by the difference.
  if (input.amountCents !== undefined && input.amountCents !== toCents(existing.amountCents)) {
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: existing.accountId }, select: { id: true, isManual: true, type: true } });
    if (acct.isManual) await moveManualBalance(userId, acct, input.amountCents - toCents(existing.amountCents));
  }
  if (input.tags) await setTags(userId, id, input.tags);
  await audit(userId, "transaction.updated", { type: "transaction", id }, { fields: Object.keys(input) });
  return { transaction: await getTransaction(userId, id), learned: learned?.learned ?? false, appliedToOthers };
}

export async function deleteTransaction(userId: string, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, userId }, select: { id: true, isManual: true, amountCents: true, accountId: true, account: { select: { id: true, isManual: true, type: true } } } });
  if (!t) throw notFound("Transaction");
  if (!t.isManual) throw new AppError("FORBIDDEN", "Imported transactions can't be deleted. You can exclude them from budgets and reports instead.");
  await prisma.transaction.delete({ where: { id } });
  if (t.account.isManual) await moveManualBalance(userId, t.account, -toCents(t.amountCents));
  await audit(userId, "transaction.deleted", { type: "transaction", id });
}

/** Re-categorises many transactions at once, keeping type and transfer flags consistent with the category (as a single edit does). */
export async function bulkUpdateCategory(userId: string, ids: string[], categoryId: string | null) {
  const cat = await assertCategory(userId, categoryId);
  const where: Prisma.TransactionWhereInput = { userId, id: { in: ids } };
  const base = { categoryId, subcategoryId: null, categorizedBy: categoryId ? ("USER" as const) : ("UNCATEGORIZED" as const), categorizedByLabel: categoryId ? "Changed by you" : null, categorizedByRuleId: null };
  let count: number;
  if (!cat) {
    count = (await prisma.transaction.updateMany({ where, data: base })).count;
  } else if (cat.kind === "TRANSFER") {
    count = (await prisma.transaction.updateMany({ where, data: { ...base, isTransfer: true, type: "TRANSFER" } })).count;
  } else {
    const [inflows, outflows] = await prisma.$transaction([
      prisma.transaction.updateMany({ where: { ...where, amountCents: { gt: 0 } }, data: { ...base, isTransfer: false, type: cat.kind === "INCOME" ? "INCOME" : "REFUND" } }),
      prisma.transaction.updateMany({ where: { ...where, amountCents: { lt: 0 } }, data: { ...base, isTransfer: false, type: "EXPENSE" } }),
    ]);
    count = inflows.count + outflows.count;
  }
  await audit(userId, "transaction.updated", { type: "transaction" }, { bulk: true, count });
  return count;
}

export async function listTags(userId: string) {
  return prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } });
}
