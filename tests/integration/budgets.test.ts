import { beforeAll, describe, expect, it } from "vitest";
import { budgetView, createBudget, upsertBudgetItem } from "@/lib/budget/service";
import { updateTransaction } from "@/lib/transactions/service";
import { categoryId, createUser, freezeTime, manualAccount, seedTransactions } from "./helpers/factory";

/**
 * Budget numbers against real transactions. Spending = −(expenses + refunds) per
 * category, excluding transfers and excluded rows, including pending ones.
 */
let userId: string;
let accountId: string;
const cat = {} as Record<"groceries" | "restaurants" | "housing" | "entertainment" | "shopping" | "income" | "transfers", string>;

const line = (categoryId: string | null, amountCents: number, over: Partial<Parameters<typeof upsertBudgetItem>[3]> = {}) => ({
  categoryId,
  amountType: "FIXED" as const,
  amountCents,
  rolloverEnabled: false,
  alertThresholds: [80, 100],
  ...over,
});

beforeAll(async () => {
  freezeTime();
  userId = (await createUser({ firstName: "Léa" })).id;
  accountId = (await manualAccount(userId, { name: "Fictional Chequing", balanceCents: 500_000 })).id;
  for (const key of ["groceries", "restaurants", "housing", "entertainment", "shopping", "income", "transfers"] as const) cat[key] = await categoryId(userId, key);

  const row = (date: string, amountCents: number, description: string, categoryId?: string, pending = false) => ({ date, amountCents, description, categoryId, pending });
  // August
  await seedTransactions(userId, accountId, [
    row("2026-08-01", -120_000, "FICTIONAL LANDLORD RENT", cat.housing),
    row("2026-08-05", -20_000, "FICTIONAL GROCER A", cat.groceries),
    row("2026-08-20", -15_000, "FICTIONAL GROCER B", cat.groceries),
    row("2026-08-10", -5_000, "FICTIONAL CINEMA", cat.entertainment),
  ]);
  // September
  const sept = await seedTransactions(userId, accountId, [
    row("2026-09-01", -120_000, "FICTIONAL LANDLORD RENT", cat.housing),
    row("2026-09-03", -30_000, "FICTIONAL GROCER A", cat.groceries),
    row("2026-09-17", -15_230, "FICTIONAL GROCER B", cat.groceries),
    row("2026-09-29", -1_000, "FICTIONAL GROCER C", cat.groceries, true),
    row("2026-09-12", -25_000, "FICTIONAL BISTRO", cat.restaurants),
    row("2026-09-14", 3_000, "FICTIONAL BISTRO REFUND", cat.restaurants),
    row("2026-09-15", -9_999, "FICTIONAL BISTRO (reimbursed by work)", cat.restaurants),
    row("2026-09-20", -30_000, "FICTIONAL CONCERT HALL", cat.entertainment),
    row("2026-09-21", -8_000, "FICTIONAL CLOTHING", cat.shopping),
    row("2026-09-22", -1_500, "QQQ FICTIONAL THING"),
    row("2026-09-25", -50_000, "FICTIONAL SAVINGS TRANSFER", cat.transfers),
    row("2026-09-05", 215_000, "FICTIONAL EMPLOYER PAYROLL", cat.income),
    row("2026-09-19", 215_000, "FICTIONAL EMPLOYER PAYROLL", cat.income),
  ]);
  // The reimbursed dinner is excluded from budgets.
  await updateTransaction(userId, sept.created[6], { isExcluded: true });
  // October (today is Oct 1)
  await seedTransactions(userId, accountId, [row("2026-10-01", -7_777, "FICTIONAL GROCER A", cat.groceries)]);
});

describe("monthly budget view", () => {
  let septemberId: string;

  it("adds up budgeted, rollover, spent and remaining per line", async () => {
    const august = await createBudget(userId, { period: "MONTHLY", startDate: "2026-08-14", copyFromPrevious: false, plannedIncomeCents: 400_000 });
    await upsertBudgetItem(userId, august.id, null, line(cat.groceries, 50_000, { rolloverEnabled: true }));
    await upsertBudgetItem(userId, august.id, null, line(cat.restaurants, 20_000));
    await upsertBudgetItem(userId, august.id, null, line(cat.housing, 120_000));
    await upsertBudgetItem(userId, august.id, null, line(cat.entertainment, 0, { amountType: "PERCENT_OF_INCOME", percentBps: 500, rolloverEnabled: true }));
    const september = await createBudget(userId, { period: "MONTHLY", startDate: "2026-09-01", copyFromPrevious: true });
    septemberId = september.id;

    const view = await budgetView(userId, september.id);
    expect(view.budget).toMatchObject({ start: "2026-09-01", end: "2026-09-30", plannedIncomeCents: 400_000 });
    const byName = Object.fromEntries(view.lines.map((l) => [l.name, l]));
    // Groceries: 46,230 spent (the pending $10 counts) of 500 + 150 carried over from August.
    expect(byName.Groceries).toMatchObject({ budgeted: 50_000, rollover: 15_000, available: 65_000, spent: 46_230, remaining: 18_770, usedBps: 7112, status: "on_track" });
    // Restaurants: the refund reduces spending, the excluded dinner doesn't count.
    expect(byName.Restaurants).toMatchObject({ budgeted: 20_000, rollover: 0, spent: 22_000, remaining: -2_000, status: "over" });
    expect(byName.Housing).toMatchObject({ budgeted: 120_000, spent: 120_000, remaining: 0, usedBps: 10_000, status: "warning" });
    // Entertainment: 5% of the $4,000 planned income, plus August's unspent $150.
    expect(byName.Entertainment).toMatchObject({ amountType: "PERCENT_OF_INCOME", budgeted: 20_000, rollover: 15_000, available: 35_000, spent: 30_000, remaining: 5_000, status: "warning" });

    // Spending without a budget line is listed, uncategorised included; the transfer and October's purchase are not.
    expect(view.unbudgeted.map((u) => [u.categoryId, u.name, u.spent])).toEqual([
      [cat.shopping, "Shopping", 8_000],
      [null, "Uncategorized", 1_500],
    ]);
    expect(view.totals).toMatchObject({ budgeted: 210_000, rollover: 30_000, available: 240_000, spent: 218_230, unbudgetedSpent: 9_500, remaining: 21_770 });
    expect(view.income).toEqual({ planned: 400_000, actual: 430_000, base: 400_000 });
    expect(view.zeroBased).toMatchObject({ income: 400_000, allocated: 210_000, unallocated: 190_000, state: "under_allocated" });
    expect(view.availableCategories.map((c) => c.name)).not.toContain("Groceries");
  });

  it("chains rollovers into the next month", async () => {
    const october = await createBudget(userId, { period: "MONTHLY", startDate: "2026-10-01", copyFromPrevious: true });
    expect(october.id).not.toBe(septemberId);
    const view = await budgetView(userId, october.id);
    const byName = Object.fromEntries(view.lines.map((l) => [l.name, l]));
    expect(byName.Groceries).toMatchObject({ rollover: 18_770, available: 68_770, spent: 7_777 });
    expect(byName.Entertainment).toMatchObject({ rollover: 5_000 });
    // Overspending is not carried.
    expect(byName.Restaurants).toMatchObject({ rollover: 0, available: 20_000 });
    // A second "create" for the same month opens the existing budget.
    expect((await createBudget(userId, { period: "MONTHLY", startDate: "2026-10-15", copyFromPrevious: true })).id).toBe(october.id);
  });

  it("keeps uncategorised spending visible when the budget has a line without a category", async () => {
    const custom = await createBudget(userId, { period: "CUSTOM", startDate: "2026-09-01", endDate: "2026-09-30", name: "September with savings", copyFromPrevious: false });
    await upsertBudgetItem(userId, custom.id, null, line(cat.groceries, 50_000));
    await upsertBudgetItem(userId, custom.id, null, line(null, 25_000, { label: "Emergency savings" }));
    const view = await budgetView(userId, custom.id);
    expect(view.lines.map((l) => [l.name, l.budgeted, l.spent])).toEqual([
      ["Groceries", 50_000, 46_230],
      ["Emergency savings", 25_000, 0],
    ]);
    expect(view.unbudgeted.find((u) => u.categoryId === null)).toMatchObject({ name: "Uncategorized", spent: 1_500 });
    expect(view.totals).toMatchObject({ budgeted: 75_000, setAside: 25_000, available: 50_000, spent: 46_230 });
  });
});

describe("rollovers of percent-of-income lines", () => {
  it("carries what was left of a percent line budgeted from actual income", async () => {
    const other = (await createUser({ firstName: "Noah" })).id;
    const account = (await manualAccount(other, { name: "Noah chequing" })).id;
    const fun = await categoryId(other, "entertainment");
    await seedTransactions(other, account, [
      { date: "2026-07-03", amountCents: 300_000, description: "FICTIONAL EMPLOYER PAYROLL", categoryId: await categoryId(other, "income") },
      { date: "2026-07-10", amountCents: -10_000, description: "FICTIONAL ARCADE", categoryId: fun },
    ]);
    const july = await createBudget(other, { period: "MONTHLY", startDate: "2026-07-01", copyFromPrevious: false });
    await upsertBudgetItem(other, july.id, null, line(fun, 0, { amountType: "PERCENT_OF_INCOME", percentBps: 1000, rolloverEnabled: true }));
    // July shows $300 budgeted (10% of the $3,000 received) and $200 left…
    const julyView = await budgetView(other, july.id);
    expect(julyView.lines[0]).toMatchObject({ budgeted: 30_000, spent: 10_000, remaining: 20_000 });
    // …so August should start with those $200.
    const august = await createBudget(other, { period: "MONTHLY", startDate: "2026-08-01", copyFromPrevious: true });
    expect((await budgetView(other, august.id)).lines[0].rollover).toBe(20_000);
  });
});
