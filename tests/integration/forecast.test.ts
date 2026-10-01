import { beforeAll, describe, expect, it } from "vitest";
import { cashFlowForecast, safeToSpend } from "@/lib/forecast/service";
import { createAutomation } from "@/lib/automation/service";
import { createBill, setBillPaid } from "@/lib/bills/service";
import { createBudget, upsertBudgetItem } from "@/lib/budget/service";
import { createGoal } from "@/lib/goals/service";
import { upsertIncomeSource } from "@/lib/income/service";
import { createSubscription } from "@/lib/subscriptions/service";
import { updateTransaction } from "@/lib/transactions/service";
import { categoryId, createUser, freezeTime, manualAccount, seedTransactions } from "./helpers/factory";

/**
 * Today is Thursday 2026-10-01 (Toronto). The next paycheque is Friday Oct 9, so
 * safe-to-spend covers Oct 1–8.
 */
let userId: string;

beforeAll(async () => {
  freezeTime("2026-10-01T16:00:00Z");
  userId = (await createUser({ firstName: "Félix", minCashBufferCents: 50_000 })).id;
  const chequing = (await manualAccount(userId, { name: "Fictional Chequing", balanceCents: 300_000 })).id;
  // Savings and debts are not spendable cash (savings can be opted in, but not here).
  await manualAccount(userId, { name: "Fictional Savings", type: "SAVINGS", balanceCents: 1_000_000 });
  await manualAccount(userId, { name: "Fictional Visa", type: "CREDIT_CARD", balanceCents: 45_000 });

  const housing = await categoryId(userId, "housing");
  const utilities = await categoryId(userId, "utilities");
  const groceries = await categoryId(userId, "groceries");

  await upsertIncomeSource(userId, null, { name: "Fictional Employer", frequency: "BIWEEKLY", averageAmountCents: 210_000, nextExpectedDate: "2026-10-09" });

  await createBill(userId, { name: "Rent", amountCents: 120_000, isVariableAmount: false, dueDate: "2026-10-01", frequency: "MONTHLY", categoryId: housing, autopay: false });
  await createBill(userId, { name: "Hydro", amountCents: 9_000, isVariableAmount: true, dueDate: "2026-10-05", frequency: "MONTHLY", categoryId: utilities, autopay: true });
  await createBill(userId, { name: "Internet", amountCents: 7_500, isVariableAmount: false, dueDate: "2026-10-12", frequency: "MONTHLY", categoryId: utilities, autopay: true });
  const phone = await createBill(userId, { name: "Phone", amountCents: 6_500, isVariableAmount: false, dueDate: "2026-10-03", frequency: "MONTHLY", categoryId: utilities, autopay: true });
  await setBillPaid(userId, phone.id, "2026-10-03", true);

  await createSubscription(userId, { name: "Fictional Streaming", amountCents: 2_299, frequency: "MONTHLY", nextChargeDate: "2026-10-08", status: "ACTIVE" });
  await createSubscription(userId, { name: "Fictional Music", amountCents: 1_199, frequency: "MONTHLY", nextChargeDate: "2026-10-16", status: "ACTIVE" });
  await createSubscription(userId, { name: "Paused Fictional Gym", amountCents: 4_000, frequency: "MONTHLY", nextChargeDate: "2026-10-04", status: "PAUSED" });

  const budget = await createBudget(userId, { period: "MONTHLY", startDate: "2026-10-01", copyFromPrevious: false });
  const item = { amountType: "FIXED" as const, rolloverEnabled: false, alertThresholds: [80, 100] };
  await upsertBudgetItem(userId, budget.id, null, { ...item, categoryId: groceries, amountCents: 60_000 });
  await upsertBudgetItem(userId, budget.id, null, { ...item, categoryId: housing, amountCents: 120_000 });
  await upsertBudgetItem(userId, budget.id, null, { ...item, categoryId: await categoryId(userId, "restaurants"), amountCents: 30_000 });

  const goal = await createGoal(userId, { name: "Fictional emergency fund", targetCents: 500_000, priority: "HIGH", icon: "shield", color: "#10b981" });
  const plan = { conditionLogic: "ALL" as const, isActive: true, conditions: [] };
  await createAutomation(userId, { ...plan, name: "Monthly savings", trigger: "SCHEDULE_MONTHLY", triggerConfig: { dayOfMonth: 5 }, actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: goal.id, amountCents: 15_000 } }] });
  await createAutomation(userId, { ...plan, name: "Monday top-up", trigger: "SCHEDULE_WEEKLY", triggerConfig: { dayOfWeek: 1 }, actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: goal.id, amountCents: 2_000 } }] });

  // History: $270 of day-to-day groceries over the last 90 days, a recurring gym fee, and today's groceries.
  const history = await seedTransactions(userId, chequing, [
    { date: "2026-08-15", amountCents: -9_000, description: "FICTIONAL GROCER", categoryId: groceries },
    { date: "2026-09-01", amountCents: -9_000, description: "FICTIONAL GROCER", categoryId: groceries },
    { date: "2026-09-20", amountCents: -9_000, description: "FICTIONAL GROCER", categoryId: groceries },
    { date: "2026-09-10", amountCents: -4_500, description: "FICTIONAL GYM MEMBERSHIP" },
    { date: "2026-10-01", amountCents: -10_000, description: "FICTIONAL GROCER", categoryId: groceries },
  ]);
  await updateTransaction(userId, history.created[3], { isRecurring: true });
});

describe("safe to spend", () => {
  it("subtracts unpaid bills, subscriptions, reserved essentials, planned savings and the buffer until payday", async () => {
    const s = await safeToSpend(userId);
    expect(s).toMatchObject({ today: "2026-10-01", nextPayday: "2026-10-09", horizon: "2026-10-09", daysUntilPayday: 8, includesSavings: false });
    // Rent (due today, unpaid) and Hydro; the paid phone bill and the Internet bill due after payday are left out.
    expect(s.details.bills.map((b) => [b.name, b.date, b.amount])).toEqual([
      ["Rent", "2026-10-01", 120_000],
      ["Hydro", "2026-10-05", 9_000],
      ["Fictional Streaming", "2026-10-08", 2_299],
    ]);
    // Groceries: $500 left of $600, pro-rated to 8 of October's 31 days. Housing is covered by the rent bill;
    // restaurants are not essential.
    expect(s.details.reserved).toEqual([{ name: "Groceries", amount: 12_903 }]);
    const lines = Object.fromEntries(s.lines.map((l) => [l.key, l.amount]));
    expect(lines).toEqual({ availableCash: 300_000, upcomingBills: 131_299, reservedBudget: 12_903, plannedSavings: 17_000, minimumBuffer: 50_000 });
    expect(s.safeToSpend).toBe(88_798);
    expect(s.perDay).toBe(11_099);
    expect(s.shortfall).toBe(0);
  });
});

describe("cash-flow forecast", () => {
  it("projects paydays, bills, subscriptions, planned savings and typical spending over 30 days", async () => {
    const f = await cashFlowForecast(userId, 30);
    expect(f.today).toBe("2026-10-01");
    expect(f.days).toHaveLength(30);
    expect(f.dailyDiscretionary).toBe(300);
    // Events of the same day may come in any order.
    const canonical = (rows: [string, string, number][]) => [...rows].sort((a, b) => a.join("|").localeCompare(b.join("|")));
    expect(canonical(f.upcoming.map((e) => [e.date, e.kind, e.amount]))).toEqual(canonical([
      ["2026-10-01", "bill", -120_000],
      ["2026-10-05", "bill", -9_000],
      ["2026-10-05", "goal", -15_000],
      ["2026-10-05", "goal", -2_000],
      ["2026-10-08", "subscription", -2_299],
      ["2026-10-09", "income", 210_000],
      ["2026-10-12", "bill", -7_500],
      ["2026-10-12", "goal", -2_000],
      ["2026-10-16", "subscription", -1_199],
      ["2026-10-19", "goal", -2_000],
      ["2026-10-23", "income", 210_000],
      ["2026-10-26", "goal", -2_000],
    ]));
    expect(f.upcoming.map((e) => e.date)).toEqual([...f.upcoming.map((e) => e.date)].sort());
    expect(f.byKind).toEqual({ income: 420_000, bill: -136_500, subscription: -3_498, goal: -23_000, expense: -9_000 });
    expect(f.startingBalance).toBe(300_000);
    expect(f.endingBalance).toBe(548_002);
    expect(f).toMatchObject({ lowestBalance: 149_301, lowestBalanceDate: "2026-10-08", belowBuffer: [] });
  });
});

describe("scheduled savings late in the month", () => {
  it("counts a 'day 31' allocation that will run on November 30", async () => {
    freezeTime("2026-11-20T17:00:00Z");
    try {
      const other = (await createUser({ firstName: "Rose", minCashBufferCents: 0 })).id;
      await manualAccount(other, { name: "Rose chequing", balanceCents: 100_000 });
      await upsertIncomeSource(other, null, { name: "Fictional pay", frequency: "MONTHLY", averageAmountCents: 300_000, nextExpectedDate: "2026-12-04" });
      const goal = await createGoal(other, { name: "Fictional fund", targetCents: 100_000, priority: "LOW", icon: "target", color: "#0ea5e9" });
      await createAutomation(other, { name: "End of month", trigger: "SCHEDULE_MONTHLY", triggerConfig: { dayOfMonth: 31 }, conditionLogic: "ALL", isActive: true, conditions: [], actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: goal.id, amountCents: 10_000 } }] });
      const s = await safeToSpend(other);
      expect(s.lines.find((l) => l.key === "plannedSavings")?.amount).toBe(10_000);
    } finally {
      freezeTime();
    }
  });
});
