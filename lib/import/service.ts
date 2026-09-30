import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { fromDbDate, toDbDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { findDuplicate, type DedupeExisting } from "@/lib/transactions/dedupe";
import { ingestTransactions } from "@/lib/transactions/ingest";
import { detectAndPersistRecurring } from "@/lib/recurring/service";
import { matchTransfers } from "@/lib/transactions/transfers";
import { MAX_IMPORT_ROWS, normalizeImportRows, type importPayloadSchema } from "./normalize";

type Payload = z.infer<typeof importPayloadSchema>;

async function prepare(userId: string, payload: Payload) {
  const account = await prisma.account.findFirst({ where: { id: payload.accountId, userId }, select: { id: true, name: true } });
  if (!account) throw notFound("Account");
  const rows = normalizeImportRows(payload.rows, payload.mapping, payload.hasHeader);
  if (rows.length > MAX_IMPORT_ROWS) throw new AppError("VALIDATION_FAILED", `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  const valid = rows.filter((r) => !r.errors.length);
  const dates = valid.map((r) => r.date!).sort();
  let existing: DedupeExisting[] = [];
  if (dates.length) {
    const found = await prisma.transaction.findMany({
      where: { userId, accountId: account.id, date: { gte: toDbDate(dates[0]), lte: toDbDate(dates[dates.length - 1]) } },
      select: { id: true, accountId: true, providerTransactionId: true, date: true, amountCents: true, description: true, merchantName: true, isPending: true, fingerprint: true },
    });
    existing = found.map((e) => ({ ...e, date: fromDbDate(e.date), amountCents: toCents(e.amountCents) }));
  }
  const claimed = new Set<string>();
  const preview = rows.map((r) => {
    if (r.errors.length) return { ...r, status: "error" as const };
    const dup = findDuplicate({ accountId: account.id, date: r.date!, amountCents: r.amountCents!, description: r.description, merchantName: r.merchantName }, existing, claimed);
    if (dup) {
      claimed.add(dup.existingId);
      return { ...r, status: "duplicate" as const };
    }
    return { ...r, status: "new" as const };
  });
  return { account, preview };
}

export async function previewImport(userId: string, payload: Payload) {
  const { preview } = await prepare(userId, payload);
  return {
    rows: preview.slice(0, 200),
    counts: {
      total: preview.length,
      new: preview.filter((r) => r.status === "new").length,
      duplicate: preview.filter((r) => r.status === "duplicate").length,
      error: preview.filter((r) => r.status === "error").length,
    },
  };
}

/** Validate → normalise → deduplicate → import → categorise (+ automations, transfers, recurring). */
export async function commitImport(userId: string, payload: Payload) {
  const { account, preview } = await prepare(userId, payload);
  const categories = await prisma.category.findMany({ where: { userId }, select: { id: true, name: true } });
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
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
      categoryId: r.categoryName ? (byName.get(r.categoryName.toLowerCase()) ?? null) : null,
    })),
    { importBatchId: batch.id, notify: false },
  );
  const errorCount = preview.filter((r) => r.status === "error").length;
  const duplicateCount = preview.length - toImport.length - errorCount + result.duplicates;
  await prisma.importBatch.update({ where: { id: batch.id }, data: { importedCount: result.created.length, duplicateCount, errorCount } });
  if (result.created.length) {
    const earliest = toImport.map((r) => r.date!).sort()[0];
    await matchTransfers(userId, earliest);
    await detectAndPersistRecurring(userId);
  }
  await audit(userId, "transaction.imported", { type: "import_batch", id: batch.id }, { imported: result.created.length, duplicates: duplicateCount, errors: errorCount });
  return { imported: result.created.length, duplicates: duplicateCount, errors: errorCount, batchId: batch.id };
}
