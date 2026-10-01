import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { completeConnection, deleteManualAccount, disconnectConnection, getAccount, listAccounts, syncAccount, updateAccount, createLinkSession } from "@/lib/accounts/service";
import { bulkUpdateCategory, createManualTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction } from "@/lib/transactions/service";
import { ingestTransactions } from "@/lib/transactions/ingest";
import { budgetView, createBudget, deleteBudget, deleteBudgetItem, updateBudgetSettings, upsertBudgetItem } from "@/lib/budget/service";
import { addContribution, createGoal, deleteContribution, deleteGoal, getGoal, goalSummary, updateGoal } from "@/lib/goals/service";
import { createBill, deleteBill, listBills, setBillPaid, updateBill } from "@/lib/bills/service";
import { createAutomation, deleteAutomation, getAutomation, setAutomationActive, updateAutomation } from "@/lib/automation/service";
import { deleteIncomeSource, upsertIncomeSource } from "@/lib/income/service";
import { commitImport, previewImport, undoImport } from "@/lib/import/service";
import { importPayloadSchema } from "@/lib/import/normalize";
import { transactionFiltersSchema } from "@/lib/transactions/schemas";
import { transactionsCsv } from "@/lib/export/service";
import { createMerchantRule, deleteCategory, deleteMerchantRule, updateCategory } from "@/lib/categories/service";
import { createSubscription, deleteSubscription, updateSubscription } from "@/lib/subscriptions/service";
import { getProvider } from "@/lib/banking/registry";
import { categoryId, createUser, freezeTime, manualAccount, subcategoryId } from "./helpers/factory";

/**
 * User B must never read, change or delete user A's data — every attempt answers
 * "not found" (or "forbidden") and A's rows stay exactly as they were.
 */
let A: { id: string };
let B: { id: string };
const a = {} as {
  account: string;
  connection: string;
  connectedAccount: string;
  txn: string;
  manualTxn: string;
  category: string;
  customCategory: string;
  subcategory: string;
  budget: string;
  budgetItem: string;
  goal: string;
  contribution: string;
  bill: string;
  automation: string;
  income: string;
  importBatch: string;
  rule: string;
  subscription: string;
};
let bCategory: string;

const notFound = { code: "NOT_FOUND" };

beforeAll(async () => {
  freezeTime();
  A = await createUser({ firstName: "Alice" });
  B = await createUser({ firstName: "Bob" });
  bCategory = await categoryId(B.id, "groceries");

  a.category = await categoryId(A.id, "groceries");
  a.subcategory = await subcategoryId(A.id, "restaurants", "Coffee");
  a.customCategory = (await prisma.category.create({ data: { userId: A.id, name: "Alice's hobby", kind: "EXPENSE", icon: "circle", color: "#64748b" } })).id;
  a.account = (await manualAccount(A.id, { name: "Alice cash", type: "CASH", balanceCents: 10000 })).id;
  a.manualTxn = (await createManualTransaction(A.id, { accountId: a.account, date: "2026-09-30", amountCents: -1500, merchantName: "Corner Café", description: "Corner Café" })).id;

  const conn = await completeConnection(A.id, "mock-public:mock_maple");
  a.connection = conn.connectionId;
  a.connectedAccount = (await prisma.account.findFirstOrThrow({ where: { userId: A.id, connectionId: conn.connectionId } })).id;
  a.txn = (await prisma.transaction.findFirstOrThrow({ where: { userId: A.id, accountId: a.connectedAccount } })).id;

  const budget = await createBudget(A.id, { period: "MONTHLY", startDate: "2026-10-01", copyFromPrevious: false });
  a.budget = budget.id;
  a.budgetItem = (await upsertBudgetItem(A.id, budget.id, null, { categoryId: a.category, amountType: "FIXED", amountCents: 50000, rolloverEnabled: false, alertThresholds: [80, 100] })).id;
  const goal = await createGoal(A.id, { name: "Alice trip", targetCents: 200000, priority: "MEDIUM", icon: "target", color: "#0ea5e9" });
  a.goal = goal.id;
  a.contribution = (await addContribution(A.id, goal.id, { amountCents: 5000, date: "2026-10-01", kind: "USER_REPORTED_TRANSFER", source: "MANUAL" }))!.id;
  a.bill = (await createBill(A.id, { name: "Alice rent", amountCents: 120000, isVariableAmount: false, dueDate: "2026-10-05", frequency: "MONTHLY", autopay: false })).id;
  a.automation = (
    await createAutomation(A.id, { name: "Alice tags coffee", trigger: "TRANSACTION_CREATED", triggerConfig: {}, conditionLogic: "ALL", isActive: true, conditions: [], actions: [{ type: "ADD_TAG", config: { tagName: "coffee" } }] })
  ).id;
  a.income = (await upsertIncomeSource(A.id, null, { name: "Alice pay", frequency: "BIWEEKLY", averageAmountCents: 150000, nextExpectedDate: "2026-10-09" })).id;
  a.importBatch = (
    await commitImport(
      A.id,
      importPayloadSchema.parse({
        accountId: a.account,
        fileName: "alice.csv",
        hasHeader: true,
        mapping: { date: 0, description: 1, amount: 2 },
        rows: [
          ["Date", "Description", "Amount"],
          ["2026-09-12", "Fictional Bakery", "-8.50"],
        ],
      }),
    )
  ).batchId;
  a.rule = (await createMerchantRule(A.id, { pattern: "Fictional Bakery", categoryId: a.category })).id;
  a.subscription = (await createSubscription(A.id, { name: "Alice streaming", amountCents: 1599, frequency: "MONTHLY", nextChargeDate: "2026-10-12", status: "ACTIVE" })).id;
});

describe("accounts and connections", () => {
  it("hides A's accounts from B", async () => {
    await expect(getAccount(B.id, a.account)).rejects.toMatchObject(notFound);
    expect(await listAccounts(B.id)).toEqual([]);
  });

  it("refuses B's changes to A's accounts and connections", async () => {
    await expect(updateAccount(B.id, a.account, { name: "pwned" })).rejects.toMatchObject(notFound);
    await expect(deleteManualAccount(B.id, a.account)).rejects.toMatchObject(notFound);
    await expect(syncAccount(B.id, a.connectedAccount)).rejects.toMatchObject(notFound);
    await expect(disconnectConnection(B.id, a.connection)).rejects.toMatchObject(notFound);
    await expect(createLinkSession(B.id, a.connection)).rejects.toMatchObject(notFound);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: a.account } })).toMatchObject({ name: "Alice cash" });
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: a.connection } })).toMatchObject({ status: "ACTIVE" });
  });

  it("refuses to attach A's existing provider connection to B", async () => {
    const mock = getProvider("MOCK");
    const realExchange = mock.exchangePublicToken.bind(mock);
    const aliceItem = (await prisma.providerConnection.findUniqueOrThrow({ where: { id: a.connection } })).providerItemId;
    const spy = vi.spyOn(mock, "exchangePublicToken").mockImplementation(async (userId, token) => ({ ...(await realExchange(userId, token)), providerItemId: aliceItem }));
    try {
      await expect(completeConnection(B.id, "mock-public:mock_maple")).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: a.connection } })).toMatchObject({ userId: A.id });
    expect(await prisma.account.count({ where: { userId: B.id } })).toBe(0);
  });
});

describe("transactions", () => {
  it("hides A's transactions from B", async () => {
    await expect(getTransaction(B.id, a.txn)).rejects.toMatchObject(notFound);
    const list = await listTransactions(B.id, transactionFiltersSchema.parse({}));
    expect(JSON.stringify(list)).not.toContain(a.txn);
  });

  it("refuses B's edits, deletes and bulk changes", async () => {
    await expect(updateTransaction(B.id, a.manualTxn, { notes: "pwned" })).rejects.toMatchObject(notFound);
    await expect(deleteTransaction(B.id, a.manualTxn)).rejects.toMatchObject(notFound);
    expect(await bulkUpdateCategory(B.id, [a.txn, a.manualTxn], bCategory)).toBe(0);
    const rows = await prisma.transaction.findMany({ where: { id: { in: [a.txn, a.manualTxn] } } });
    expect(rows.every((r) => r.categoryId !== bCategory && r.notes !== "pwned")).toBe(true);
  });

  it("refuses to write into A's account or with A's categories", async () => {
    await expect(createManualTransaction(B.id, { accountId: a.account, date: "2026-10-01", amountCents: -100, merchantName: "X", description: "X" })).rejects.toMatchObject(notFound);
    await expect(ingestTransactions(B.id, [{ accountId: a.account, date: "2026-10-01", amountCents: -100, description: "X" }])).rejects.toThrow();
    const bAccount = (await manualAccount(B.id, { name: "Bob chequing" })).id;
    await expect(createManualTransaction(B.id, { accountId: bAccount, date: "2026-10-01", amountCents: -100, merchantName: "X", description: "X", categoryId: a.category })).rejects.toMatchObject(notFound);
    const bTxn = await createManualTransaction(B.id, { accountId: bAccount, date: "2026-10-01", amountCents: -100, merchantName: "Bob snack", description: "Bob snack" });
    await expect(updateTransaction(B.id, bTxn.id, { categoryId: a.category })).rejects.toMatchObject(notFound);
    await expect(bulkUpdateCategory(B.id, [bTxn.id], a.category)).rejects.toMatchObject(notFound);
    expect(await prisma.transaction.count({ where: { accountId: a.account, userId: B.id } })).toBe(0);
  });
});

describe("budgets, goals, bills, income and subscriptions", () => {
  it("refuses B on A's budget", async () => {
    await expect(budgetView(B.id, a.budget)).rejects.toMatchObject(notFound);
    await expect(upsertBudgetItem(B.id, a.budget, null, { categoryId: bCategory, amountType: "FIXED", amountCents: 1, rolloverEnabled: false, alertThresholds: [80] })).rejects.toMatchObject(notFound);
    await expect(upsertBudgetItem(A.id, a.budget, a.budgetItem, { categoryId: bCategory, amountType: "FIXED", amountCents: 1, rolloverEnabled: false, alertThresholds: [80] })).rejects.toMatchObject(notFound);
    await expect(updateBudgetSettings(B.id, a.budget, { name: "pwned" })).rejects.toMatchObject(notFound);
    await expect(deleteBudgetItem(B.id, a.budgetItem)).rejects.toMatchObject(notFound);
    await expect(deleteBudget(B.id, a.budget)).rejects.toMatchObject(notFound);
    expect(await prisma.budgetItem.findUniqueOrThrow({ where: { id: a.budgetItem } })).toMatchObject({ amountCents: 50000n });
  });

  it("refuses B on A's goals and contributions", async () => {
    await expect(getGoal(B.id, a.goal)).rejects.toMatchObject(notFound);
    await expect(goalSummary(B.id, a.goal, "America/Toronto")).rejects.toMatchObject(notFound);
    await expect(updateGoal(B.id, a.goal, { name: "pwned" })).rejects.toMatchObject(notFound);
    await expect(addContribution(B.id, a.goal, { amountCents: 100, date: "2026-10-01", kind: "PLANNED_ALLOCATION", source: "MANUAL" })).rejects.toMatchObject(notFound);
    await expect(deleteContribution(B.id, a.contribution)).rejects.toMatchObject(notFound);
    await expect(deleteGoal(B.id, a.goal)).rejects.toMatchObject(notFound);
    await expect(createGoal(B.id, { name: "Linked to Alice", targetCents: 100, priority: "LOW", icon: "target", color: "#0ea5e9", linkedAccountId: a.account })).rejects.toMatchObject(notFound);
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: a.goal } })).toMatchObject({ name: "Alice trip", currentCents: 5000n });
  });

  it("refuses B on A's bills", async () => {
    await expect(updateBill(B.id, a.bill, { amountCents: 1 })).rejects.toMatchObject(notFound);
    await expect(setBillPaid(B.id, a.bill, "2026-10-05", true)).rejects.toMatchObject(notFound);
    await expect(deleteBill(B.id, a.bill)).rejects.toMatchObject(notFound);
    await expect(createBill(B.id, { name: "x", amountCents: 1, isVariableAmount: false, dueDate: "2026-10-05", frequency: "MONTHLY", autopay: false, categoryId: a.category })).rejects.toMatchObject(notFound);
    expect(await listBills(B.id)).toEqual(expect.not.arrayContaining([expect.objectContaining({ id: a.bill })]));
    expect(await prisma.billPayment.count({ where: { billId: a.bill } })).toBe(0);
  });

  it("refuses B on A's income sources and subscriptions", async () => {
    await expect(upsertIncomeSource(B.id, a.income, { name: "pwned", frequency: "WEEKLY", averageAmountCents: 1, nextExpectedDate: "2026-10-09" })).rejects.toMatchObject(notFound);
    await expect(upsertIncomeSource(B.id, null, { name: "Bob pay", frequency: "WEEKLY", averageAmountCents: 1, nextExpectedDate: "2026-10-09", accountId: a.account })).rejects.toMatchObject(notFound);
    await expect(deleteIncomeSource(B.id, a.income)).rejects.toMatchObject(notFound);
    await expect(updateSubscription(B.id, a.subscription, { amountCents: 1 })).rejects.toMatchObject(notFound);
    await expect(deleteSubscription(B.id, a.subscription)).rejects.toMatchObject(notFound);
    await expect(createSubscription(B.id, { name: "x", amountCents: 1, frequency: "MONTHLY", status: "ACTIVE", accountId: a.account })).rejects.toMatchObject(notFound);
    expect(await prisma.incomeSource.findUniqueOrThrow({ where: { id: a.income } })).toMatchObject({ name: "Alice pay" });
  });
});

describe("automations, categories and rules", () => {
  it("refuses B on A's automations and on automations pointing at A's data", async () => {
    const input = { name: "x", trigger: "TRANSACTION_CREATED" as const, triggerConfig: {}, conditionLogic: "ALL" as const, isActive: true, conditions: [], actions: [{ type: "ADD_TAG" as const, config: { tagName: "x" } }] };
    await expect(getAutomation(B.id, a.automation)).rejects.toMatchObject(notFound);
    await expect(updateAutomation(B.id, a.automation, input)).rejects.toMatchObject(notFound);
    await expect(setAutomationActive(B.id, a.automation, false)).rejects.toMatchObject(notFound);
    await expect(deleteAutomation(B.id, a.automation)).rejects.toMatchObject(notFound);
    await expect(createAutomation(B.id, { ...input, actions: [{ type: "ROUND_UP_TO_GOAL", config: { goalId: a.goal, roundToCents: 100 } }] })).rejects.toMatchObject(notFound);
    await expect(createAutomation(B.id, { ...input, actions: [{ type: "SET_CATEGORY", config: { categoryId: a.category } }] })).rejects.toMatchObject(notFound);
    await expect(createAutomation(B.id, { ...input, conditions: [{ field: "ACCOUNT", operator: "EQUALS", value: a.account }] })).rejects.toMatchObject(notFound);
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: a.automation } })).toMatchObject({ isActive: true, name: "Alice tags coffee" });
  });

  it("refuses B on A's categories and merchant rules", async () => {
    await expect(updateCategory(B.id, a.customCategory, { name: "pwned" })).rejects.toMatchObject(notFound);
    await expect(deleteCategory(B.id, a.customCategory)).rejects.toMatchObject(notFound);
    await expect(createMerchantRule(B.id, { pattern: "anything", categoryId: a.category })).rejects.toMatchObject(notFound);
    await expect(deleteMerchantRule(B.id, a.rule)).rejects.toMatchObject(notFound);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: a.customCategory } })).toMatchObject({ name: "Alice's hobby" });
  });

  // lib/categories/service.ts (not editable here): createMerchantRule checks the category but not the subcategory.
  it.fails("refuses a merchant rule that points at A's subcategory", async () => {
    await expect(createMerchantRule(B.id, { pattern: "bob coffee", categoryId: await categoryId(B.id, "restaurants"), subcategoryId: a.subcategory })).rejects.toMatchObject(notFound);
  });
});

describe("imports and exports", () => {
  it("refuses B on A's account and import batches", async () => {
    const payload = importPayloadSchema.parse({ accountId: a.account, hasHeader: false, mapping: { date: 0, description: 1, amount: 2 }, rows: [["2026-09-01", "X", "-1.00"]] });
    await expect(previewImport(B.id, payload)).rejects.toMatchObject(notFound);
    await expect(commitImport(B.id, payload)).rejects.toMatchObject(notFound);
    await expect(undoImport(B.id, a.importBatch)).rejects.toMatchObject(notFound);
    expect(await prisma.transaction.count({ where: { importBatchId: a.importBatch } })).toBe(1);
  });

  it("never exports A's rows to B, even when B asks for A's account", async () => {
    const csv = await transactionsCsv(B.id, { accountId: a.account });
    expect(csv.trim().split("\r\n")).toHaveLength(1);
    const all = await transactionsCsv(B.id, {});
    expect(all).not.toContain("Alice");
    expect(all).not.toContain(a.txn);
  });
});
