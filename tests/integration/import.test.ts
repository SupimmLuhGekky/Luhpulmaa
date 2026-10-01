import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { commitImport, listImportBatches, previewImport, undoImport } from "@/lib/import/service";
import { importPayloadSchema } from "@/lib/import/normalize";
import { createManualTransaction } from "@/lib/transactions/service";
import { balanceOf, createUser, freezeTime, manualAccount, seedTransactions } from "./helpers/factory";

/** A fictional bank export: signed amounts, a status column and the bank's own category labels. */
const FILE = [
  ["Date", "Description", "Amount", "Status", "Category"],
  ["2026-09-02", "IGA EXTRA #123 MONTREAL QC", "-45.23", "Posted", "Groceries"],
  ["2026-09-03", "STM OPUS RECHARGE", "-94.00", "Posted", ""],
  ["2026-09-04", "FICTIONAL EMPLOYER PAYROLL", "2,150.00", "Posted", "Income"],
  ["2026-09-05", "VIREMENT FICTIONAL DOG WALKER", "-60.00", "Posted", "Pet care"],
  ["2026-09-06", "SAQ SELECTION 23001", "-32.50", "Pending", ""],
  ["2026-09-06", "FICTIONAL ELECTRONICS", "-999.99", "Declined", ""],
  ["not a date", "BROKEN ROW", "-1.00", "Posted", ""],
  ["2026-09-07", "FICTIONAL ZERO ROW", "0.00", "Posted", ""],
  ["2026-09-08", "FICTIONAL FURNITURE", "-250.00", "Posted", "Home Improvement"],
];
const MAPPING = { date: 0, description: 1, amount: 2, status: 3, category: 4 };

let userId: string;
let accountId: string;
let petCare: string;

function payload(rows: string[][], fileName = "fictional-export.csv", account = accountId) {
  return importPayloadSchema.parse({ accountId: account, fileName, hasHeader: true, mapping: MAPPING, rows });
}

beforeAll(async () => {
  freezeTime();
  userId = (await createUser({ firstName: "Inès" })).id;
  accountId = (await manualAccount(userId, { name: "Fictional Chequing", balanceCents: 300_000 })).id;
  petCare = (await prisma.category.create({ data: { userId, name: "Pet care", kind: "EXPENSE", icon: "dog", color: "#a16207" } })).id;
  // Already in the account (e.g. entered by hand): the file's IGA row duplicates it.
  await seedTransactions(userId, accountId, [{ date: "2026-09-01", amountCents: -4523, description: "IGA EXTRA 123 MONTREAL" }]);
});

describe("CSV import", () => {
  let batchId: string;

  it("previews what will be imported, skipped, flagged as duplicate or rejected", async () => {
    const preview = await previewImport(userId, payload(FILE));
    expect(preview.counts).toEqual({ total: 9, new: 4, duplicate: 1, skipped: 2, error: 2 });
    const byDescription = Object.fromEntries(preview.rows.map((r) => [r.description, r]));
    expect(byDescription["IGA EXTRA #123 MONTREAL QC"]).toMatchObject({ status: "duplicate" });
    expect(byDescription["SAQ SELECTION 23001"]).toMatchObject({ status: "skipped", skipReason: "Pending" });
    expect(byDescription["FICTIONAL ELECTRONICS"]).toMatchObject({ status: "skipped", skipReason: "Declined" });
    expect(byDescription["BROKEN ROW"]).toMatchObject({ status: "error", errors: ["Unrecognised date"], line: 8 });
    expect(byDescription["FICTIONAL ZERO ROW"]).toMatchObject({ status: "error", errors: ["Amount is zero"] });
    expect(byDescription["FICTIONAL EMPLOYER PAYROLL"]).toMatchObject({ status: "new", amountCents: 215_000 });
    // Previewing writes nothing.
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
    expect(await prisma.importBatch.count({ where: { userId } })).toBe(0);
  });

  it("imports exactly the new rows and categorises them", async () => {
    const res = await commitImport(userId, payload(FILE));
    expect(res).toMatchObject({ imported: 4, duplicates: 1, skipped: 2, errors: 2 });
    batchId = res.batchId;
    expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).toMatchObject({ rowCount: 9, importedCount: 4, duplicateCount: 1, errorCount: 2, fileName: "fictional-export.csv" });

    const rows = await prisma.transaction.findMany({ where: { importBatchId: batchId }, include: { category: true }, orderBy: { date: "asc" } });
    expect(rows.map((r) => [r.description, Number(r.amountCents), r.type, r.category?.systemKey ?? r.category?.name ?? null])).toEqual([
      ["STM OPUS RECHARGE", -9400, "EXPENSE", "transportation"],
      ["FICTIONAL EMPLOYER PAYROLL", 215_000, "INCOME", "income"],
      // The file's label matches the user's own category: applied as chosen, and it is spending, not a transfer.
      ["VIREMENT FICTIONAL DOG WALKER", -6000, "EXPENSE", "Pet care"],
      // A bank label is only a hint ("Home Improvement" → Housing).
      ["FICTIONAL FURNITURE", -25_000, "EXPENSE", "housing"],
    ]);
    expect(rows.find((r) => r.categoryId === petCare)).toMatchObject({ categorizedBy: "USER", isTransfer: false });
    expect(rows.find((r) => r.description === "FICTIONAL FURNITURE")).toMatchObject({ categorizedBy: "PROVIDER" });
    expect(rows.every((r) => !r.isManual && !r.isPending)).toBe(true);
    // Imported history doesn't move a manual account's balance (the balance is entered separately).
    expect(await balanceOf(accountId)).toBe(300_000);
  });

  it("adds nothing when the same file is imported again", async () => {
    const before = await prisma.transaction.count({ where: { accountId } });
    expect((await previewImport(userId, payload(FILE))).counts).toMatchObject({ new: 0, duplicate: 5 });
    const res = await commitImport(userId, payload(FILE, "fictional-export (1).csv"));
    expect(res).toMatchObject({ imported: 0, duplicates: 5, skipped: 2, errors: 2 });
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(before);
    // An overlapping export with reworded descriptions is recognised too.
    const reworded = [FILE[0], ["2026-09-04", "Fictional Employer Payroll DEP", "2150.00", "Completed", ""], ["2026-09-09", "FICTIONAL BAKERY", "-8.50", "Completed", ""]];
    expect(await commitImport(userId, payload(reworded, "overlap.csv"))).toMatchObject({ imported: 1, duplicates: 1 });
  });

  it("keeps identical purchases from one file but never re-imports them", async () => {
    const coffees = (n: number) => [FILE[0], ...Array.from({ length: n }, () => ["2026-09-20", "TIM HORTONS #4410", "-2.50", "Posted", ""])];
    expect(await commitImport(userId, payload(coffees(2), "coffees.csv"))).toMatchObject({ imported: 2, duplicates: 0 });
    // A later export holding three of them adds only the one that is new.
    expect(await commitImport(userId, payload(coffees(3), "coffees-again.csv"))).toMatchObject({ imported: 1, duplicates: 2 });
    expect(await prisma.transaction.count({ where: { accountId, description: "TIM HORTONS #4410" } })).toBe(3);
  });

  it("undo removes exactly that import's transactions", async () => {
    const manual = await createManualTransaction(userId, { accountId, date: "2026-09-03", amountCents: -9400, merchantName: "STM OPUS RECHARGE" });
    const otherBatches = await prisma.importBatch.findMany({ where: { userId, id: { not: batchId } }, select: { id: true } });
    const keepCount = await prisma.transaction.count({ where: { accountId, OR: [{ importBatchId: null }, { importBatchId: { not: batchId } }] } });

    expect(await undoImport(userId, batchId)).toEqual({ removed: 4 });
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(keepCount);
    expect(await prisma.transaction.findUnique({ where: { id: manual.id } })).not.toBeNull();
    expect(await prisma.importBatch.findUnique({ where: { id: batchId } })).toBeNull();
    expect((await listImportBatches(userId, 50)).map((b) => b.id).sort()).toEqual(otherBatches.map((b) => b.id).sort());
    await expect(undoImport(userId, batchId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // With that batch gone, its rows can be imported again; the manual STM entry now absorbs the STM row.
    expect(await commitImport(userId, payload(FILE, "fictional-export (2).csv"))).toMatchObject({ imported: 3, duplicates: 2 });
  });

  it("reads separate debit and credit columns and refuses another user's account", async () => {
    const account = (await manualAccount(userId, { name: "Fictional Visa", type: "CREDIT_CARD" })).id;
    const rows = [
      ["Transaction Date", "Description", "Debit", "Credit"],
      ["09/14/2026", "FICTIONAL BOOKSHOP", "23.45", ""],
      ["09/15/2026", "PAYMENT THANK YOU / PAIEMENT MERCI", "", "500.00"],
    ];
    const p = importPayloadSchema.parse({ accountId: account, hasHeader: true, mapping: { date: 0, description: 1, debit: 2, credit: 3, dateFormat: "MM/DD/YYYY" }, rows });
    expect(await commitImport(userId, p)).toMatchObject({ imported: 2 });
    const imported = await prisma.transaction.findMany({ where: { accountId: account }, orderBy: { date: "asc" } });
    expect(imported.map((t) => [t.date.toISOString().slice(0, 10), Number(t.amountCents), t.type])).toEqual([
      ["2026-09-14", -2345, "EXPENSE"],
      ["2026-09-15", 50_000, "TRANSFER"],
    ]);

    const stranger = await createUser({ firstName: "Stranger" });
    await expect(commitImport(stranger.id, p)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.transaction.count({ where: { accountId: account } })).toBe(2);
  });
});
