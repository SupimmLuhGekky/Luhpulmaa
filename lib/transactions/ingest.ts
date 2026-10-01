import "server-only";
import type { CategorizationSource, Prisma, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDbDate, toDbDate, type LocalDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { runTransactionAutomations } from "@/lib/automation/engine";
import { suggestCategoryWithAI } from "@/lib/ai/categorize";
import { categorize } from "./categorization";
import { loadCategorizationContext } from "./context";
import { findDuplicate, transactionFingerprint, type DedupeExisting } from "./dedupe";
import { displayMerchant, normalizeMerchant } from "./normalize";
import { notifyLargeTransactions } from "./alerts";

/**
 * Single entry point for writing new transactions (provider sync, CSV import,
 * manual entry). Guarantees:
 *   - duplicates are never created (provider id, pending→posted, fingerprint, fuzzy)
 *   - a posted transaction replaces its pending version in place, keeping user edits
 *   - new transactions are categorised, linked to a merchant and run through automations
 */
export interface IngestRow {
  accountId: string;
  providerTransactionId?: string | null;
  pendingTransactionId?: string | null;
  date: LocalDate;
  postedDate?: LocalDate | null;
  amountCents: number;
  currency?: string;
  description: string;
  merchantName?: string | null;
  pending?: boolean;
  categoryHint?: string | null;
  /** Explicit category chosen by the user (manual entry / CSV column). */
  categoryId?: string | null;
  subcategoryId?: string | null;
  notes?: string | null;
  isManual?: boolean;
}

export interface IngestResult {
  created: string[];
  updated: string[];
  duplicates: number;
}

export interface IngestOptions {
  importBatchId?: string;
  runAutomations?: boolean;
  notify?: boolean;
  /** Existing transaction ids already matched to other rows of the same file, which must not absorb these rows. */
  claimedIds?: Iterable<string>;
}

export async function ingestTransactions(userId: string, rows: IngestRow[], opts: IngestOptions = {}): Promise<IngestResult> {
  const result: IngestResult = { created: [], updated: [], duplicates: 0 };
  if (!rows.length) return result;

  // Ownership: every target account must belong to the user.
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const accounts = await prisma.account.findMany({ where: { userId, id: { in: accountIds } }, select: { id: true, currency: true } });
  if (accounts.length !== accountIds.length) throw new Error("Transaction targets an account the user does not own");
  const accountCurrency = new Map(accounts.map((a) => [a.id, a.currency]));

  const dates = rows.map((r) => r.date).sort();
  const windowStart = addDays(dates[0], -7);
  const windowEnd = addDays(dates[dates.length - 1], 7);
  const providerIds = rows.flatMap((r) => [r.providerTransactionId, r.pendingTransactionId]).filter((x): x is string => Boolean(x));

  const existingRows = await prisma.transaction.findMany({
    where: {
      userId,
      accountId: { in: accountIds },
      OR: [{ date: { gte: toDbDate(windowStart), lte: toDbDate(windowEnd) } }, ...(providerIds.length ? [{ providerTransactionId: { in: providerIds } }] : [])],
    },
    select: { id: true, accountId: true, providerTransactionId: true, date: true, amountCents: true, description: true, merchantName: true, isPending: true, fingerprint: true, categorizedBy: true },
  });
  const existing: (DedupeExisting & { categorizedBy: CategorizationSource })[] = existingRows.map((e) => ({
    id: e.id,
    accountId: e.accountId,
    providerTransactionId: e.providerTransactionId,
    date: fromDbDate(e.date),
    amountCents: toCents(e.amountCents),
    description: e.description,
    merchantName: e.merchantName,
    isPending: e.isPending,
    fingerprint: e.fingerprint,
    categorizedBy: e.categorizedBy,
  }));

  const ctx = await loadCategorizationContext(userId);
  const merchantCache = new Map<string, string>();
  const claimed = new Set<string>(opts.claimedIds ?? []);

  async function merchantIdFor(name: string, defaultCategoryId: string | null): Promise<string | null> {
    const key = normalizeMerchant(name);
    if (!key) return null;
    const cached = merchantCache.get(key);
    if (cached) return cached;
    const merchant = await prisma.merchant.upsert({
      where: { userId_normalizedName: { userId, normalizedName: key } },
      update: {},
      create: { userId, normalizedName: key, name: name.length > 60 ? displayMerchant(name) : name, defaultCategoryId },
    });
    merchantCache.set(key, merchant.id);
    return merchant.id;
  }

  for (const row of rows) {
    // Manual entries are deliberate (two identical coffees are two coffees), so they skip duplicate matching.
    const match = row.isManual ? null : findDuplicate(row, existing, claimed);
    if (match) {
      claimed.add(match.existingId);
      const target = existing.find((e) => e.id === match.existingId)!;
      if (match.kind === "pending_to_posted" || (match.kind === "provider_id" && target.isPending && !row.pending)) {
        // Posted version replaces the pending one, preserving category/notes/tags the user set.
        await prisma.transaction.update({
          where: { id: target.id },
          data: {
            providerTransactionId: row.providerTransactionId ?? target.providerTransactionId,
            isPending: false,
            postedDate: row.postedDate ? toDbDate(row.postedDate) : toDbDate(row.date),
            amountCents: row.amountCents,
            date: toDbDate(row.date),
            description: row.description,
            fingerprint: transactionFingerprint(row),
          },
        });
        target.isPending = false;
        target.providerTransactionId = row.providerTransactionId ?? target.providerTransactionId;
        result.updated.push(target.id);
      } else if (match.kind !== "provider_id" && row.providerTransactionId && !target.providerTransactionId) {
        // A manual/CSV row later seen from the provider: adopt the provider id so future syncs match exactly.
        await prisma.transaction.update({ where: { id: target.id }, data: { providerTransactionId: row.providerTransactionId } }).catch(() => undefined);
        target.providerTransactionId = row.providerTransactionId;
        result.duplicates++;
      } else {
        result.duplicates++;
      }
      continue;
    }

    let cat = categorize({ description: row.description, merchantName: row.merchantName, amountCents: row.amountCents, categoryHint: row.categoryHint }, ctx);
    let categorizedBy: CategorizationSource = cat.source;
    let label = cat.label;
    let categoryId = cat.categoryId;
    let subcategoryId = cat.subcategoryId;
    if (row.categoryId) {
      const chosen = ctx.categories.find((c) => c.id === row.categoryId);
      if (chosen) {
        categoryId = chosen.id;
        subcategoryId = row.subcategoryId && chosen.subcategories.some((s) => s.id === row.subcategoryId) ? row.subcategoryId : null;
        categorizedBy = "USER";
        label = "Chosen by you";
        // The chosen category decides the type, as when the user edits a transaction ("Virement Interac" filed as Rent is spending).
        const type: TransactionType =
          chosen.kind === "TRANSFER" ? "TRANSFER" : chosen.kind === "INCOME" ? (row.amountCents > 0 ? "INCOME" : "EXPENSE") : row.amountCents > 0 ? "REFUND" : "EXPENSE";
        cat = { ...cat, type, isTransfer: type === "TRANSFER" };
      }
    } else if (!categoryId) {
      const ai = await suggestCategoryWithAI(userId, { description: row.description, merchantName: row.merchantName ?? null, amountCents: row.amountCents }, ctx);
      if (ai) {
        categoryId = ai.categoryId;
        categorizedBy = "AI";
        label = "Suggested by AI (review recommended)";
      }
    }

    const merchantName = row.merchantName?.trim() || displayMerchant(row.description);
    const merchantId = await merchantIdFor(merchantName, categoryId);
    const fingerprint = transactionFingerprint(row);
    const data: Prisma.TransactionUncheckedCreateInput = {
      userId,
      accountId: row.accountId,
      providerTransactionId: row.providerTransactionId ?? null,
      pendingTransactionId: row.pendingTransactionId ?? null,
      date: toDbDate(row.date),
      postedDate: row.postedDate ? toDbDate(row.postedDate) : null,
      merchantId,
      merchantName,
      description: row.description.slice(0, 500),
      amountCents: row.amountCents,
      currency: row.currency ?? accountCurrency.get(row.accountId) ?? "CAD",
      type: cat.type,
      isTransfer: cat.isTransfer,
      categoryId,
      subcategoryId,
      categorizedBy,
      categorizedByRuleId: cat.ruleId,
      categorizedByLabel: label,
      isPending: Boolean(row.pending),
      isManual: Boolean(row.isManual),
      notes: row.notes ?? null,
      fingerprint,
      importBatchId: opts.importBatchId ?? null,
    };
    try {
      const created = await prisma.transaction.create({ data, select: { id: true } });
      result.created.push(created.id);
      existing.push({ id: created.id, accountId: row.accountId, providerTransactionId: row.providerTransactionId ?? null, date: row.date, amountCents: row.amountCents, description: row.description, merchantName, isPending: Boolean(row.pending), fingerprint, categorizedBy });
      claimed.add(created.id);
    } catch (error) {
      // Unique (accountId, providerTransactionId) — a concurrent sync inserted it first.
      if ((error as { code?: string }).code === "P2002") {
        result.duplicates++;
        continue;
      }
      throw error;
    }
  }

  if (result.created.length) {
    if (opts.runAutomations !== false) await runTransactionAutomations(userId, result.created);
    if (opts.notify !== false) await notifyLargeTransactions(userId, result.created);
  }
  return result;
}
