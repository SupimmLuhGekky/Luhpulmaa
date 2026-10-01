import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { bulkUpdateCategory, createManualTransaction, deleteTransaction, listTransactions, updateTransaction } from "@/lib/transactions/service";
import { ingestTransactions } from "@/lib/transactions/ingest";
import { normalizeMerchant } from "@/lib/transactions/normalize";
import { transactionFiltersSchema } from "@/lib/transactions/schemas";
import { balanceOf, categoryId, createUser, freezeTime, manualAccount, seedTransactions, subcategoryId } from "./helpers/factory";

let userId: string;
let chequing: string;
const cat = {} as Record<"groceries" | "restaurants" | "shopping" | "housing" | "healthcare" | "income" | "transfers", string>;

async function txn(id: string) {
  return prisma.transaction.findUniqueOrThrow({ where: { id } });
}

beforeAll(async () => {
  freezeTime();
  userId = (await createUser({ firstName: "Camille" })).id;
  chequing = (await manualAccount(userId, { name: "Fictional Chequing", balanceCents: 100_000 })).id;
  for (const key of ["groceries", "restaurants", "shopping", "housing", "healthcare", "income", "transfers"] as const) {
    cat[key] = await categoryId(userId, key);
  }
});

describe("ingest deduplication", () => {
  it("never inserts the same provider transaction twice", async () => {
    const account = (await manualAccount(userId, { name: "Dedupe by id" })).id;
    const rows = [
      { providerTransactionId: "prov-001", date: "2026-09-10", amountCents: -4523, description: "IGA EXTRA #123 MONTREAL QC" },
      { providerTransactionId: "prov-002", date: "2026-09-11", amountCents: -1299, description: "STM OPUS RECHARGE" },
    ];
    const first = await seedTransactions(userId, account, rows);
    expect(first.created).toHaveLength(2);
    // The same rows again, even with a shifted date and a reworded description.
    const again = await seedTransactions(userId, account, rows.map((r) => ({ ...r, date: "2026-09-12", description: r.description.toLowerCase() })));
    expect(again).toMatchObject({ created: [], duplicates: 2 });
    expect(await prisma.transaction.count({ where: { accountId: account } })).toBe(2);
  });

  it("replaces a pending transaction with its posted version, keeping the user's category", async () => {
    const account = (await manualAccount(userId, { name: "Pending to posted" })).id;
    const [pendingId] = (await seedTransactions(userId, account, [{ providerTransactionId: "pd-77", date: "2026-09-28", amountCents: -3000, description: "FICTIONAL BRASSERIE", pending: true }])).created;
    await updateTransaction(userId, pendingId, { categoryId: cat.restaurants });

    const posted = await seedTransactions(userId, account, [{ providerTransactionId: "post-77", pendingTransactionId: "pd-77", date: "2026-09-29", amountCents: -3450, description: "FICTIONAL BRASSERIE MTL" }]);
    expect(posted).toMatchObject({ created: [], updated: [pendingId] });
    expect(await prisma.transaction.count({ where: { accountId: account } })).toBe(1);
    const row = await txn(pendingId);
    expect(row).toMatchObject({ isPending: false, providerTransactionId: "post-77", amountCents: -3450n, categoryId: cat.restaurants, categorizedBy: "USER" });
  });

  it("treats a re-exported CSV row (no ids, slightly different text, a day apart) as a duplicate", async () => {
    const account = (await manualAccount(userId, { name: "Fuzzy CSV" })).id;
    await seedTransactions(userId, account, [{ date: "2026-09-10", amountCents: -4523, description: "IGA EXTRA #123 MONTREAL QC" }]);
    const res = await seedTransactions(userId, account, [
      { date: "2026-09-11", amountCents: -4523, description: "IGA EXTRA 123 MONTREAL" },
      // Same store, different amount: a second real purchase.
      { date: "2026-09-11", amountCents: -4524, description: "IGA EXTRA 123 MONTREAL" },
      // Same amount and store but well outside the date window: also real.
      { date: "2026-09-20", amountCents: -4523, description: "IGA EXTRA #123 MONTREAL QC" },
    ]);
    expect(res.duplicates).toBe(1);
    expect(res.created).toHaveLength(2);
  });

  it("keeps two identical purchases from the same file, and re-importing that file adds nothing", async () => {
    const account = (await manualAccount(userId, { name: "Two coffees" })).id;
    const coffees = [
      { date: "2026-09-15", amountCents: -250, description: "TIM HORTONS #4410" },
      { date: "2026-09-15", amountCents: -250, description: "TIM HORTONS #4410" },
    ];
    expect((await seedTransactions(userId, account, coffees)).created).toHaveLength(2);
    expect(await seedTransactions(userId, account, coffees)).toMatchObject({ created: [], duplicates: 2 });
    expect(await prisma.transaction.count({ where: { accountId: account } })).toBe(2);
  });

  it("refuses rows for an account the user doesn't own", async () => {
    const other = await createUser({ firstName: "Other" });
    const foreign = (await manualAccount(other.id, { name: "Not yours" })).id;
    await expect(ingestTransactions(userId, [{ accountId: foreign, date: "2026-09-01", amountCents: -100, description: "X" }])).rejects.toThrow(/does not own/);
    expect(await prisma.transaction.count({ where: { accountId: foreign } })).toBe(0);
  });
});

describe("manual transactions and manual balances", () => {
  it("moves a manual chequing balance on create, amount edits and delete", async () => {
    expect(await balanceOf(chequing)).toBe(100_000);
    const t = await createManualTransaction(userId, { accountId: chequing, date: "2026-09-30", amountCents: -1500, merchantName: "Fictional Dépanneur" });
    expect(t).toMatchObject({ isManual: true, amountCents: -1500, type: "EXPENSE" });
    expect(await balanceOf(chequing)).toBe(98_500);

    await updateTransaction(userId, t.id, { amountCents: -2000 });
    expect(await balanceOf(chequing)).toBe(98_000);
    // Editing other fields leaves the balance alone.
    await updateTransaction(userId, t.id, { notes: "milk and bread", merchantName: "Fictional Dépanneur Plus" });
    expect(await balanceOf(chequing)).toBe(98_000);

    await deleteTransaction(userId, t.id);
    expect(await balanceOf(chequing)).toBe(100_000);
    expect(await prisma.transaction.findUnique({ where: { id: t.id } })).toBeNull();
  });

  it("moves a manual credit card balance the other way (purchases increase what is owed)", async () => {
    const card = (await manualAccount(userId, { name: "Fictional Visa", type: "CREDIT_CARD", balanceCents: 0 })).id;
    const purchase = await createManualTransaction(userId, { accountId: card, date: "2026-09-20", amountCents: -5000, merchantName: "Fictional Hardware" });
    expect(await balanceOf(card)).toBe(5000);
    await createManualTransaction(userId, { accountId: card, date: "2026-09-25", amountCents: 2000, merchantName: "Payment received", categoryId: cat.transfers });
    expect(await balanceOf(card)).toBe(3000);
    await updateTransaction(userId, purchase.id, { amountCents: -6000 });
    expect(await balanceOf(card)).toBe(4000);
    await deleteTransaction(userId, purchase.id);
    expect(await balanceOf(card)).toBe(-2000);
  });

  it("re-types a manual transaction whose amount changes direction", async () => {
    const account = (await manualAccount(userId, { name: "Direction flips", balanceCents: 0 })).id;
    const pharmacy = await createManualTransaction(userId, { accountId: account, date: "2026-09-10", amountCents: -1500, merchantName: "Fictional Pharmacy", categoryId: cat.healthcare });
    expect(pharmacy.type).toBe("EXPENSE");
    await updateTransaction(userId, pharmacy.id, { amountCents: 1500 });
    expect(await txn(pharmacy.id)).toMatchObject({ type: "REFUND", amountCents: 1500n });

    const gig = await createManualTransaction(userId, { accountId: account, date: "2026-09-11", amountCents: 40_000, merchantName: "Fictional freelance client", categoryId: cat.income });
    expect(gig.type).toBe("INCOME");
    // Direction and category changed in the same save: the new amount decides.
    await updateTransaction(userId, gig.id, { amountCents: -40_000, categoryId: cat.shopping });
    expect(await txn(gig.id)).toMatchObject({ type: "EXPENSE", categoryId: cat.shopping });
    await updateTransaction(userId, gig.id, { amountCents: 40_000 });
    expect(await txn(gig.id)).toMatchObject({ type: "REFUND" });
    expect(await balanceOf(account)).toBe(1500 + 40_000);
  });

  it("records two identical manual entries as two fully categorised transactions", async () => {
    const account = (await manualAccount(userId, { name: "Manual twins", balanceCents: 10_000 })).id;
    const input = { accountId: account, date: "2026-09-30", amountCents: -250, merchantName: "Tim Hortons" };
    const first = await createManualTransaction(userId, input);
    const second = await createManualTransaction(userId, input);
    expect(second.id).not.toBe(first.id);
    expect(await balanceOf(account)).toBe(9_500);
    const [a, b] = await Promise.all([txn(first.id), txn(second.id)]);
    expect(a.categoryId).toBe(cat.restaurants);
    expect(b).toMatchObject({ categoryId: a.categoryId, subcategoryId: a.subcategoryId, categorizedBy: a.categorizedBy, merchantId: a.merchantId, type: a.type });
  });

  it("uses the category the user picked to decide the type, even when the text looks like a transfer", async () => {
    // Rent paid by Interac e-Transfer is spending, not a transfer between own accounts.
    const rent = await createManualTransaction(userId, { accountId: chequing, date: "2026-09-01", amountCents: -95_000, merchantName: "Virement Interac loyer", categoryId: cat.housing, subcategoryId: await subcategoryId(userId, "housing", "Rent") });
    expect(rent).toMatchObject({ type: "EXPENSE", isTransfer: false, category: { id: cat.housing } });
    // A friend paying back their share of dinner reduces restaurant spending (a refund), it isn't income.
    const payback = await createManualTransaction(userId, { accountId: chequing, date: "2026-09-02", amountCents: 2000, merchantName: "Marie paid me back", categoryId: cat.restaurants });
    expect(payback).toMatchObject({ type: "REFUND", isTransfer: false });
    // A transfer category always wins.
    const toSavings = await createManualTransaction(userId, { accountId: chequing, date: "2026-09-03", amountCents: -10_000, merchantName: "Fictional savings", categoryId: cat.transfers });
    expect(toSavings).toMatchObject({ type: "TRANSFER", isTransfer: true });
  });
});

describe("editing transactions", () => {
  it("refuses date and amount changes on imported transactions without side effects", async () => {
    const account = (await manualAccount(userId, { name: "Imported edits" })).id;
    const { created } = await seedTransactions(userId, account, [
      { date: "2026-09-20", amountCents: -2500, description: "FICTIONAL BISTRO 123", merchantName: "Fictional Bistro" },
      { date: "2026-09-22", amountCents: -3100, description: "FICTIONAL BISTRO 123", merchantName: "Fictional Bistro" },
    ]);
    const before = await Promise.all(created.map(txn));

    await expect(updateTransaction(userId, created[0], { amountCents: -1, categoryId: cat.shopping, applyToMerchant: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateTransaction(userId, created[0], { date: "2026-09-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteTransaction(userId, created[0])).rejects.toMatchObject({ code: "FORBIDDEN" });

    const after = await Promise.all(created.map(txn));
    expect(after.map((t) => [t.categoryId, t.amountCents, t.date])).toEqual(before.map((t) => [t.categoryId, t.amountCents, t.date]));
    expect(await prisma.merchantRule.count({ where: { userId, pattern: normalizeMerchant("Fictional Bistro") } })).toBe(0);
  });

  it("learns a merchant's category after two corrections and uses it for new transactions", async () => {
    const account = (await manualAccount(userId, { name: "Learning" })).id;
    const { created } = await seedTransactions(userId, account, [
      { date: "2026-09-01", amountCents: -1800, description: "ZYXW ATELIER 001", merchantName: "Zyxw Atelier" },
      { date: "2026-09-08", amountCents: -2200, description: "ZYXW ATELIER 001", merchantName: "Zyxw Atelier" },
    ]);
    expect((await txn(created[0])).categoryId).toBeNull();

    const first = await updateTransaction(userId, created[0], { categoryId: cat.shopping });
    expect(first.learned).toBe(false);
    const second = await updateTransaction(userId, created[1], { categoryId: cat.shopping });
    expect(second.learned).toBe(true);
    const rule = await prisma.merchantRule.findFirstOrThrow({ where: { userId, pattern: normalizeMerchant("Zyxw Atelier") } });
    expect(rule).toMatchObject({ isActive: true, correctionCount: 2, categoryId: cat.shopping, source: "USER_CORRECTION" });

    const next = await seedTransactions(userId, account, [{ date: "2026-09-15", amountCents: -2600, description: "ZYXW ATELIER 001", merchantName: "Zyxw Atelier" }]);
    expect(await txn(next.created[0])).toMatchObject({ categoryId: cat.shopping, categorizedBy: "MERCHANT_RULE", categorizedByRuleId: rule.id });
  });

  it("keeps type and transfer flags consistent when a category change is applied to the merchant's other transactions", async () => {
    const account = (await manualAccount(userId, { name: "Landlord" })).id;
    const rows = ["2026-07-01", "2026-08-01", "2026-09-01"].map((date) => ({ date, amountCents: -120_000, description: "VIREMENT FICTIONAL PROPERTY MGMT", merchantName: "Fictional Property Mgmt" }));
    const { created } = await seedTransactions(userId, account, [
      ...rows,
      { date: "2026-09-15", amountCents: 50_000, description: "VIREMENT FICTIONAL PROPERTY MGMT DEPOT", merchantName: "Fictional Property Mgmt" },
    ]);
    // The built-in keyword ("virement") files them all as transfers at first.
    for (const id of created) expect(await txn(id)).toMatchObject({ type: "TRANSFER", isTransfer: true });

    const res = await updateTransaction(userId, created[2], { categoryId: cat.housing, applyToMerchant: true });
    expect(res.appliedToOthers).toBe(3);
    const after = await Promise.all(created.map(txn));
    expect(after.map((t) => [t.categoryId, t.type, t.isTransfer])).toEqual([
      [cat.housing, "EXPENSE", false],
      [cat.housing, "EXPENSE", false],
      [cat.housing, "EXPENSE", false],
      [cat.housing, "REFUND", false],
    ]);

    // And back: marking the merchant as a transfer flags every transaction.
    await updateTransaction(userId, created[0], { categoryId: cat.transfers, applyToMerchant: true });
    const back = await Promise.all(created.map(txn));
    // created[0] was changed by the user; created[2] keeps the user's own earlier choice.
    expect(back.map((t) => [t.categoryId, t.type, t.isTransfer])).toEqual([
      [cat.transfers, "TRANSFER", true],
      [cat.transfers, "TRANSFER", true],
      [cat.housing, "EXPENSE", false],
      [cat.transfers, "TRANSFER", true],
    ]);
  });

  it("switches type and transfer flag with the chosen category on a single edit", async () => {
    const account = (await manualAccount(userId, { name: "Single edits" })).id;
    const { created } = await seedTransactions(userId, account, [{ date: "2026-09-05", amountCents: -4000, description: "FICTIONAL GADGETS" }]);
    await updateTransaction(userId, created[0], { categoryId: cat.transfers });
    expect(await txn(created[0])).toMatchObject({ type: "TRANSFER", isTransfer: true, categorizedBy: "USER" });
    await updateTransaction(userId, created[0], { categoryId: cat.shopping });
    expect(await txn(created[0])).toMatchObject({ type: "EXPENSE", isTransfer: false });
    await updateTransaction(userId, created[0], { isTransfer: true });
    expect(await txn(created[0])).toMatchObject({ type: "TRANSFER", isTransfer: true });
    await updateTransaction(userId, created[0], { isTransfer: false });
    expect(await txn(created[0])).toMatchObject({ type: "EXPENSE", isTransfer: false });
  });
});

describe("bulk re-categorisation", () => {
  async function mixedRows(label: string) {
    const account = (await manualAccount(userId, { name: `Bulk ${label}` })).id;
    const { created } = await seedTransactions(userId, account, [
      { date: "2026-09-10", amountCents: -4000, description: "FICTIONAL HARDWARE STORE" },
      { date: "2026-09-12", amountCents: 1500, description: "FICTIONAL HARDWARE STORE REFUND" },
      { date: "2026-09-14", amountCents: -10_000, description: "ONLINE TRANSFER TO SAVINGS" },
    ]);
    return created;
  }

  it("sets type and transfer flags from the category kind", async () => {
    const [purchase, refund, transfer] = await mixedRows("expense");
    expect(await txn(transfer)).toMatchObject({ type: "TRANSFER", isTransfer: true });

    expect(await bulkUpdateCategory(userId, [purchase, refund, transfer], cat.shopping)).toBe(3);
    expect(await Promise.all([purchase, refund, transfer].map(txn))).toMatchObject([
      { categoryId: cat.shopping, type: "EXPENSE", isTransfer: false, categorizedBy: "USER", subcategoryId: null },
      { categoryId: cat.shopping, type: "REFUND", isTransfer: false },
      { categoryId: cat.shopping, type: "EXPENSE", isTransfer: false },
    ]);

    expect(await bulkUpdateCategory(userId, [purchase, refund, transfer], cat.income)).toBe(3);
    expect(await Promise.all([purchase, refund, transfer].map(txn))).toMatchObject([
      { type: "EXPENSE", isTransfer: false },
      { type: "INCOME", isTransfer: false },
      { type: "EXPENSE", isTransfer: false },
    ]);

    expect(await bulkUpdateCategory(userId, [purchase, refund, transfer], cat.transfers)).toBe(3);
    for (const id of [purchase, refund, transfer]) expect(await txn(id)).toMatchObject({ categoryId: cat.transfers, type: "TRANSFER", isTransfer: true });

    expect(await bulkUpdateCategory(userId, [purchase], null)).toBe(1);
    expect(await txn(purchase)).toMatchObject({ categoryId: null, categorizedBy: "UNCATEGORIZED", categorizedByLabel: null });
  });

  it("also re-categorises zero-amount bank rows (e.g. $0.00 card verifications)", async () => {
    const [purchase] = await mixedRows("zero");
    const { created } = await seedTransactions(userId, (await txn(purchase)).accountId, [{ providerTransactionId: "auth-0", date: "2026-09-16", amountCents: 0, description: "FICTIONAL STREAMING CARD CHECK" }]);
    expect(await bulkUpdateCategory(userId, [purchase, created[0]], cat.shopping)).toBe(2);
    expect(await txn(created[0])).toMatchObject({ categoryId: cat.shopping, type: "EXPENSE", isTransfer: false });
  });
});

describe("listing", () => {
  it("filters by text, category, absolute amount and pages through results", async () => {
    const other = await createUser({ firstName: "Lister" });
    const account = (await manualAccount(other.id, { name: "List" })).id;
    await seedTransactions(other.id, account, [
      { date: "2026-09-01", amountCents: 250_000, description: "FICTIONAL EMPLOYER PAYROLL" },
      { date: "2026-09-02", amountCents: -4523, description: "IGA EXTRA #123 MONTREAL QC" },
      { date: "2026-09-03", amountCents: -1299, description: "SAQ SELECTION 23001" },
      { date: "2026-09-04", amountCents: -50_000, description: "ONLINE TRANSFER TO SAVINGS" },
      { date: "2026-09-05", amountCents: -777, description: "QQQ UNKNOWN THING" },
    ]);
    const list = (f: Record<string, unknown>) => listTransactions(other.id, transactionFiltersSchema.parse(f));

    const all = await list({});
    expect(all.total).toBe(5);
    expect(all.rows.map((r) => r.date)).toEqual(["2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01"]);
    // Transfers are left out of the inflow/outflow totals.
    expect(all.totals).toEqual({ inflow: 250_000, outflow: 4523 + 1299 + 777 });

    expect((await list({ q: "iga" })).rows.map((r) => r.amountCents)).toEqual([-4523]);
    expect((await list({ categoryId: "uncategorized" })).rows.map((r) => r.description)).toEqual(["QQQ UNKNOWN THING"]);
    expect((await list({ minCents: 1000, maxCents: 5000 })).rows.map((r) => r.amountCents)).toEqual([-1299, -4523]);
    expect((await list({ type: "TRANSFER" })).total).toBe(1);
    expect((await list({ from: "2026-09-02", to: "2026-09-03", sort: "amount_asc" })).rows.map((r) => r.amountCents)).toEqual([-4523, -1299]);

    const page2 = await list({ pageSize: 10, page: 2 });
    expect(page2).toMatchObject({ rows: [], total: 5, pageCount: 1 });
  });
});
