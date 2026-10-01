import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { fromDbDate, toDbDate, type LocalDate } from "@/lib/dates";
import { toCents, type Cents } from "@/lib/finance/money";

/**
 * Canonical definitions used everywhere (budgets, analytics, insights, dashboard):
 *  - Spending  = −(sum of EXPENSE and REFUND amounts), excluding transfers and excluded rows.
 *    Refunds therefore reduce spending in their category.
 *  - Income    = sum of INCOME amounts, excluding transfers and excluded rows.
 * Pending transactions are included (they are real commitments).
 */
/** Optional narrowing to some accounts and/or categories (empty = no restriction). */
export interface TxnScope {
  accountIds?: string[];
  categoryIds?: string[];
}

function normalizeScope(scope?: TxnScope | string[]): TxnScope {
  return Array.isArray(scope) ? { accountIds: scope } : (scope ?? {});
}

function scopeWhere(scope?: TxnScope | string[]): Prisma.TransactionWhereInput {
  const s = normalizeScope(scope);
  return {
    ...(s.accountIds?.length ? { accountId: { in: s.accountIds } } : {}),
    ...(s.categoryIds?.length ? { categoryId: { in: s.categoryIds } } : {}),
  };
}

function scopeSql(scope?: TxnScope): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (scope?.accountIds?.length) parts.push(Prisma.sql`AND "accountId" = ANY(${scope.accountIds}::uuid[])`);
  if (scope?.categoryIds?.length) parts.push(Prisma.sql`AND "categoryId" = ANY(${scope.categoryIds}::uuid[])`);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

const SPENDING_WHERE = (userId: string, from: LocalDate, to: LocalDate, scope?: TxnScope | string[]): Prisma.TransactionWhereInput => ({
  userId,
  date: { gte: toDbDate(from), lte: toDbDate(to) },
  isTransfer: false,
  isExcluded: false,
  type: { in: ["EXPENSE", "REFUND"] },
  ...scopeWhere(scope),
});

/** Date of the earliest counted transaction in scope: where the user's history starts (null when there is none). */
export async function firstTransactionDate(userId: string, scope?: TxnScope): Promise<LocalDate | null> {
  const row = await prisma.transaction.findFirst({
    where: { userId, isTransfer: false, isExcluded: false, ...scopeWhere(scope) },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  return row ? fromDbDate(row.date) : null;
}

/** Spending per category. `scope` may also be a plain list of account ids (older callers). */
export async function spendingByCategory(userId: string, from: LocalDate, to: LocalDate, scope?: TxnScope | string[]): Promise<Map<string | null, Cents>> {
  const rows = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: SPENDING_WHERE(userId, from, to, scope),
    _sum: { amountCents: true },
  });
  return new Map(rows.map((r) => [r.categoryId, -toCents(r._sum.amountCents)]));
}

export async function totalSpending(userId: string, from: LocalDate, to: LocalDate, scope?: TxnScope): Promise<Cents> {
  const r = await prisma.transaction.aggregate({ where: SPENDING_WHERE(userId, from, to, scope), _sum: { amountCents: true } });
  return -toCents(r._sum.amountCents);
}

export async function totalIncome(userId: string, from: LocalDate, to: LocalDate, scope?: TxnScope): Promise<Cents> {
  const r = await prisma.transaction.aggregate({
    where: { userId, date: { gte: toDbDate(from), lte: toDbDate(to) }, isTransfer: false, isExcluded: false, type: "INCOME", ...scopeWhere(scope) },
    _sum: { amountCents: true },
  });
  return toCents(r._sum.amountCents);
}

export interface PeriodTotals {
  period: string; // "2026-10" (month) or "2026-09-28" (week start) or day
  income: Cents;
  spending: Cents;
}

/** Income and spending bucketed by month, week or day, computed in SQL. */
export async function incomeSpendingSeries(userId: string, from: LocalDate, to: LocalDate, bucket: "month" | "week" | "day", scope?: TxnScope): Promise<PeriodTotals[]> {
  const trunc = bucket === "month" ? "month" : bucket === "week" ? "week" : "day";
  const rows = await prisma.$queryRaw<{ period: Date; income: bigint | null; spending: bigint | null }[]>`
    SELECT date_trunc(${trunc}, "date")::date AS period,
           SUM(CASE WHEN "type" = 'INCOME' THEN "amountCents" ELSE 0 END)::bigint AS income,
           (-SUM(CASE WHEN "type" IN ('EXPENSE','REFUND') THEN "amountCents" ELSE 0 END))::bigint AS spending
    FROM "transactions"
    WHERE "userId" = ${userId}::uuid
      AND "date" BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
      AND "isTransfer" = false AND "isExcluded" = false
      ${scopeSql(scope)}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({
    period: bucket === "month" ? r.period.toISOString().slice(0, 7) : r.period.toISOString().slice(0, 10),
    income: toCents(r.income ?? 0n),
    spending: toCents(r.spending ?? 0n),
  }));
}

export async function spendingByMerchant(userId: string, from: LocalDate, to: LocalDate, take = 10, scope?: TxnScope) {
  const rows = await prisma.transaction.groupBy({
    by: ["merchantName"],
    where: SPENDING_WHERE(userId, from, to, scope),
    _sum: { amountCents: true },
    _count: { _all: true },
    orderBy: { _sum: { amountCents: "asc" } },
    take,
  });
  return rows.map((r) => ({ merchant: r.merchantName ?? "Unknown", spending: -toCents(r._sum.amountCents), count: r._count._all })).filter((r) => r.spending > 0);
}

export async function spendingByCategoryPerMonth(userId: string, from: LocalDate, to: LocalDate) {
  const rows = await prisma.$queryRaw<{ month: Date; categoryId: string | null; spending: bigint }[]>`
    SELECT date_trunc('month', "date")::date AS month, "categoryId", (-SUM("amountCents"))::bigint AS spending
    FROM "transactions"
    WHERE "userId" = ${userId}::uuid AND "date" BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
      AND "isTransfer" = false AND "isExcluded" = false AND "type" IN ('EXPENSE','REFUND')
    GROUP BY 1, 2`;
  return rows.map((r) => ({ month: r.month.toISOString().slice(0, 7), categoryId: r.categoryId, spending: toCents(r.spending) }));
}
