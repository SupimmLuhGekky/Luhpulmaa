import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { addDays, fromDbDate, toDbDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { findDuplicate, FUZZY_DATE_WINDOW_DAYS, type DedupeExisting } from "@/lib/transactions/dedupe";
import { ingestTransactions } from "@/lib/transactions/ingest";
import { detectAndPersistRecurring } from "@/lib/recurring/service";
import { matchTransfers } from "@/lib/transactions/transfers";
import { bankCategoryToSystemKey } from "./bank-categories";
import { MAX_IMPORT_ROWS, normalizeImportRows, type importPayloadSchema } from "./normalize";

type Payload = z.infer<typeof importPayloadSchema>;

async function prepare(userId: string, payload: Payload) {
  const account = await prisma.account.findFirst({ where: { id: payload.accountId, userId }, select: { id: true, name: true } });
  if (!account) throw notFound("Account");
  const rows = normalizeImportRows(payload.rows, payload.mapping, payload.hasHeader);
  if (rows.length > MAX_IMPORT_ROWS) throw new AppError("VALIDATION_FAILED", `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  const valid = rows.filter((r) => !r.errors.length && !r.skipReason);
  const dates = valid.map((r) => r.date!).sort();
  let existing: DedupeExisting[] = [];
  if (dates.length) {
    // Look a few days past both ends: a row on the file's first day can duplicate one from the day before.
    const from = addDays(dates[0], -FUZZY_DATE_WINDOW_DAYS);
    const to = addDays(dates[dates.length - 1], FUZZY_DATE_WINDOW_DAYS);
    const found = await prisma.transaction.findMany({
      where: { userId, accountId: account.id, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      select: { id: true, accountId: true, providerTransactionId: true, date: true, amountCents: true, description: true, merchantName: true, isPending: true, fingerprint: true },
    });
    existing = found.map((e) => ({ ...e, date: fromDbDate(e.date), amountCents: toCents(e.amountCents) }));
  }
  const claimed = new Set<string>();
  const preview = rows.map((r) => {
    if (r.errors.length) return { ...r, status: "error" as const };
    if (r.skipReason) return { ...r, status: "skipped" as const };
    const dup = findDuplicate({ accountId: account.id, date: r.date!, amountCents: r.amountCents!, description: r.description, merchantName: r.merchantName }, existing, claimed);
    if (dup) {
      claimed.add(dup.existingId);
      return { ...r, status: "duplicate" as const };
    }
    return { ...r, status: "new" as const };
  });
  return { account, preview, claimed };
}

export async function previewImport(userId: string, payload: Payload) {
  const { preview } = await prepare(userId, payload);
  return {
    rows: preview.slice(0, 200),
    counts: {
      total: preview.length,
      new: preview.filter((r) => r.status === "new").length,
      duplicate: preview.filter((r) => r.status === "duplicate").length,
      skipped: preview.filter((r) => r.status === "skipped").length,
      error: preview.filter((r) => r.status === "error").length,
    },
  };
}

/** Validate → normalise → deduplicate → import → categorise (+ automations, transfers, recurring). */
export async function commitImport(userId: string, payload: Payload) {
  const { account, preview, claimed } = await prepare(userId, payload);
  const categories = await prisma.category.findMany({ where: { userId }, select: { id: true, name: true, systemKey: true } });
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  // The file's category column: a match to one of the user's own custom categories is
  // applied as-is; built-in names and bank labels only hint (user rules still win).
  const categoryFor = (name: string | null) => {
    if (!name) return { categoryId: null, categoryHint: null };
    const match = byName.get(name.toLowerCase());
    if (match && !match.systemKey) return { categoryId: match.id, categoryHint: null };
    return { categoryId: null, categoryHint: match?.systemKey ?? bankCategoryToSystemKey(name) };
  };
  const batch = await prisma.importBatch.create({ data: { userId, accountId: account.id, fileName: payload.fileName?.slice(0, 200), rowCount: preview.length } });
  const toImport = preview.filter((r) => r.status === "new");
  const result = await ingestTransactions(
    userId,
    toImport.map((r) => ({
      accountId: account.id,
      date: r.date!,
      amountCents: r.amountCents!,
      description: r.description,
      merchantName: r.merchantName,
      ...categoryFor(r.categoryName),
    })),
    // Existing rows the preview already matched to other lines of this file can't absorb the new ones
    // (a file with three identical coffees against two already imported adds exactly one).
    { importBatchId: batch.id, notify: false, claimedIds: claimed },
  );
  const errorCount = preview.filter((r) => r.status === "error").length;
  const skippedCount = preview.filter((r) => r.status === "skipped").length;
  const duplicateCount = preview.length - toImport.length - errorCount - skippedCount + result.duplicates;
  await prisma.importBatch.update({ where: { id: batch.id }, data: { importedCount: result.created.length, duplicateCount, errorCount } });
  if (result.created.length) {
    const earliest = toImport.map((r) => r.date!).sort()[0];
    await matchTransfers(userId, earliest);
    await detectAndPersistRecurring(userId);
  }
  await audit(userId, "transaction.imported", { type: "import_batch", id: batch.id }, { imported: result.created.length, duplicates: duplicateCount, skipped: skippedCount, errors: errorCount });
  return { imported: result.created.length, duplicates: duplicateCount, skipped: skippedCount, errors: errorCount, batchId: batch.id };
}

/** Recent imports, newest first, for the import page's history list. */
export async function listImportBatches(userId: string, take = 10) {
  const rows = await prisma.importBatch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, fileName: true, rowCount: true, importedCount: true, duplicateCount: true, errorCount: true, createdAt: true, account: { select: { id: true, name: true } }, _count: { select: { transactions: true } } },
  });
  return rows.map((b) => ({
    id: b.id,
    fileName: b.fileName,
    rowCount: b.rowCount,
    importedCount: b.importedCount,
    duplicateCount: b.duplicateCount,
    errorCount: b.errorCount,
    createdAt: b.createdAt.toISOString(),
    account: b.account,
    remaining: b._count.transactions,
  }));
}

/** Removes every transaction a CSV import added (and the import record). Manual and bank-synced transactions are untouched. */
export async function undoImport(userId: string, batchId: string) {
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, userId }, select: { id: true } });
  if (!batch) throw notFound("Import");
  const [removed] = await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { userId, importBatchId: batch.id } }),
    prisma.importBatch.delete({ where: { id: batch.id } }),
  ]);
  await detectAndPersistRecurring(userId);
  await audit(userId, "transaction.import_undone", { type: "import_batch", id: batch.id }, { removed: removed.count });
  return { removed: removed.count };
}
