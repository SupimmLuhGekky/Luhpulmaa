import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { applyToRecent, createAutomation } from "@/lib/automation/service";
import { runScheduledAutomations, runTransactionAutomations } from "@/lib/automation/engine";
import { createGoal } from "@/lib/goals/service";
import { createManualTransaction } from "@/lib/transactions/service";
import { balanceOf, categoryId, createUser, freezeTime, manualAccount, seedTransactions } from "./helpers/factory";

/**
 * Automations fire on new transactions (sync, CSV, manual) and on schedules. Goal
 * actions only record planned allocations: they never move money. Every run is
 * claimed once per (automation, event), so nothing is applied twice.
 */
let userId: string;
let accountId: string;
let vacation: string;
let car: string;

type AutomationInput = Parameters<typeof createAutomation>[1];
const automation = (over: Partial<AutomationInput> & Pick<AutomationInput, "name" | "actions">): AutomationInput => ({
  trigger: "TRANSACTION_CREATED",
  triggerConfig: {},
  conditionLogic: "ALL",
  isActive: true,
  conditions: [],
  ...over,
});

async function tagsOf(transactionId: string) {
  return (await prisma.transactionTag.findMany({ where: { transactionId }, include: { tag: true } })).map((t) => t.tag.name).sort();
}

beforeAll(async () => {
  freezeTime();
  userId = (await createUser({ firstName: "Zoé" })).id;
  accountId = (await manualAccount(userId, { name: "Fictional Chequing", balanceCents: 100_000 })).id;
  vacation = (await createGoal(userId, { name: "Fictional vacation", targetCents: 100_000, priority: "MEDIUM", icon: "plane", color: "#f59e0b" })).id;
  car = (await createGoal(userId, { name: "Fictional car", targetCents: 500_000, priority: "HIGH", icon: "car", color: "#0ea5e9" })).id;
});

describe("transaction automations", () => {
  let coffeeAutomation: string;
  let coffee: string;
  let groceries: string;

  it("tag and round up matching purchases as they arrive, planning (not moving) the round-up", async () => {
    coffeeAutomation = (
      await createAutomation(
        userId,
        automation({
          name: "Coffee round-ups",
          conditions: [{ field: "MERCHANT", operator: "EQUALS", value: "Tim Hortons" }],
          actions: [
            { type: "ADD_TAG", config: { tagName: "coffee" } },
            { type: "ROUND_UP_TO_GOAL", config: { goalId: vacation, roundToCents: 100 } },
          ],
        }),
      )
    ).id;
    const { created } = await seedTransactions(
      userId,
      accountId,
      [
        { date: "2026-09-30", amountCents: -275, description: "TIM HORTONS #4410", merchantName: "Tim Hortons" },
        { date: "2026-09-30", amountCents: -4523, description: "METRO #212 MONTREAL QC", merchantName: "Metro" },
      ],
      { runAutomations: true },
    );
    [coffee, groceries] = created;

    expect(await tagsOf(coffee)).toEqual(["coffee"]);
    expect(await tagsOf(groceries)).toEqual([]);
    const contributions = await prisma.goalContribution.findMany({ where: { goalId: vacation } });
    expect(contributions).toEqual([expect.objectContaining({ amountCents: 25n, kind: "PLANNED_ALLOCATION", source: "ROUND_UP", automationId: coffeeAutomation, transactionId: coffee })]);
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: vacation } })).toMatchObject({ currentCents: 25n });

    const runs = await prisma.automationRun.findMany({ where: { automationId: coffeeAutomation } });
    expect(runs).toEqual([expect.objectContaining({ transactionId: coffee, status: "SUCCESS", summary: "tag “coffee”; round-up of $0.25 planned for Fictional vacation" })]);
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: coffeeAutomation } })).toMatchObject({ executionCount: 1 });

    // Nothing moved: the account balance and the transaction list are as before.
    expect(await balanceOf(accountId)).toBe(100_000);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(2);
  });

  it("never applies an automation twice to the same transaction", async () => {
    expect(await runTransactionAutomations(userId, [coffee, groceries])).toEqual({ executed: 0 });
    await applyToRecent(userId, coffeeAutomation, 30);
    expect(await prisma.goalContribution.count({ where: { goalId: vacation } })).toBe(1);
    expect(await prisma.automationRun.count({ where: { automationId: coffeeAutomation } })).toBe(1);
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: coffeeAutomation } })).toMatchObject({ executionCount: 1 });
  });

  it("plans a share of each paycheque for a goal, and only for income", async () => {
    const pay = (
      await createAutomation(userId, automation({ name: "Payday: 10% for the car", trigger: "INCOME_RECEIVED", actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: car, percentBps: 1000 } }] }))
    ).id;
    const income = await categoryId(userId, "income");
    const { created } = await seedTransactions(
      userId,
      accountId,
      [
        { date: "2026-10-01", amountCents: 215_050, description: "FICTIONAL EMPLOYER PAYROLL", categoryId: income },
        { date: "2026-10-01", amountCents: 2_000, description: "FICTIONAL STORE REFUND", categoryId: await categoryId(userId, "shopping") },
      ],
      { runAutomations: true },
    );
    const planned = await prisma.goalContribution.findMany({ where: { automationId: pay } });
    expect(planned).toEqual([expect.objectContaining({ amountCents: 21_505n, kind: "PLANNED_ALLOCATION", source: "AUTOMATION", transactionId: created[0] })]);
  });

  it("runs on manual transactions too, and only the entry itself moves the balance", async () => {
    const before = await balanceOf(accountId);
    const t = await createManualTransaction(userId, { accountId, date: "2026-10-01", amountCents: -150, merchantName: "Tim Hortons" });
    expect(await balanceOf(accountId)).toBe(before - 150);
    expect(await tagsOf(t.id)).toEqual(["coffee"]);
    expect(await prisma.goalContribution.findFirst({ where: { transactionId: t.id } })).toMatchObject({ amountCents: 50n, kind: "PLANNED_ALLOCATION" });
  });

  it("skips inactive automations and honours ALL/ANY conditions", async () => {
    await createAutomation(userId, automation({ name: "Switched off", isActive: false, actions: [{ type: "ADD_TAG", config: { tagName: "never" } }] }));
    const note = (
      await createAutomation(
        userId,
        automation({
          name: "Big or pharmacy",
          conditionLogic: "ANY",
          conditions: [
            { field: "AMOUNT", operator: "GREATER_THAN", value: "10000" },
            { field: "DESCRIPTION", operator: "CONTAINS", value: "pharmacy" },
          ],
          actions: [{ type: "SET_NOTE", config: { note: "Check the receipt" } }],
        }),
      )
    ).id;
    const both = (
      await createAutomation(
        userId,
        automation({
          name: "Big pharmacy",
          conditions: [
            { field: "AMOUNT", operator: "GREATER_THAN", value: "10000" },
            { field: "DESCRIPTION", operator: "CONTAINS", value: "pharmacy" },
          ],
          actions: [{ type: "ADD_TAG", config: { tagName: "big-pharmacy" } }],
        }),
      )
    ).id;
    const { created } = await seedTransactions(
      userId,
      accountId,
      [
        { date: "2026-10-01", amountCents: -1_500, description: "FICTIONAL PHARMACY" },
        { date: "2026-10-01", amountCents: -50_000, description: "FICTIONAL TV STORE" },
        { date: "2026-10-01", amountCents: -2_000, description: "FICTIONAL BOOKSHOP" },
        { date: "2026-10-01", amountCents: -12_000, description: "FICTIONAL PHARMACY PLUS" },
      ],
      { runAutomations: true },
    );
    const rows = await prisma.transaction.findMany({ where: { id: { in: created } } });
    const noteOf = (id: string) => rows.find((r) => r.id === id)?.notes ?? null;
    expect(created.map(noteOf)).toEqual(["Check the receipt", "Check the receipt", null, "Check the receipt"]);
    expect(await Promise.all(created.map(tagsOf))).toEqual([[], [], [], ["big-pharmacy"]]);
    expect(await prisma.tag.count({ where: { userId, name: "never" } })).toBe(0);
    expect(await prisma.automationRun.count({ where: { automationId: note } })).toBe(3);
    expect(await prisma.automationRun.count({ where: { automationId: both } })).toBe(1);
  });

  it("makes a transfer-looking payment spending when an automation files it under an expense category", async () => {
    const housing = await categoryId(userId, "housing");
    await createAutomation(userId, automation({ name: "Landlord → Housing", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", value: "landlord" }], actions: [{ type: "SET_CATEGORY", config: { categoryId: housing } }] }));
    const { created } = await seedTransactions(userId, accountId, [{ date: "2026-10-01", amountCents: -95_000, description: "VIREMENT INTERAC LANDLORD FICTIF" }], { runAutomations: true });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: created[0] } })).toMatchObject({ categoryId: housing, categorizedBy: "AUTOMATION", type: "EXPENSE", isTransfer: false });
  });

  it("'apply to recent transactions' runs only the chosen automation", async () => {
    const { created } = await seedTransactions(userId, accountId, [{ date: "2026-09-28", amountCents: -350, description: "FICTIONAL BAKERY", merchantName: "Fictional Bakery" }]);
    // Created after the purchase and never applied to the past by the user.
    await createAutomation(userId, automation({ name: "Bakery round-ups", conditions: [{ field: "MERCHANT", operator: "EQUALS", value: "Fictional Bakery" }], actions: [{ type: "ROUND_UP_TO_GOAL", config: { goalId: vacation, roundToCents: 100 } }] }));
    const tagBakery = (await createAutomation(userId, automation({ name: "Tag bakery", conditions: [{ field: "MERCHANT", operator: "EQUALS", value: "Fictional Bakery" }], actions: [{ type: "ADD_TAG", config: { tagName: "bakery" } }] }))).id;

    await applyToRecent(userId, tagBakery, 30);
    expect(await tagsOf(created[0])).toEqual(["bakery"]);
    expect(await prisma.goalContribution.count({ where: { transactionId: created[0] } })).toBe(0);
  });
});

describe("scheduled automations", () => {
  it("allocate once per month, catching up on short months", async () => {
    const monthly = (
      await createAutomation(userId, automation({ name: "Monthly $150 for the car", trigger: "SCHEDULE_MONTHLY", triggerConfig: { dayOfMonth: 1 }, actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: car, amountCents: 15_000 } }] }))
    ).id;
    const endOfMonth = (
      await createAutomation(userId, automation({ name: "Day 31", trigger: "SCHEDULE_MONTHLY", triggerConfig: { dayOfMonth: 31 }, actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: car, amountCents: 1_000 } }] }))
    ).id;
    const dates = async (id: string) => (await prisma.goalContribution.findMany({ where: { automationId: id }, orderBy: { date: "asc" } })).map((c) => c.date.toISOString().slice(0, 10));

    await runScheduledAutomations(userId, "2026-10-01");
    await runScheduledAutomations(userId, "2026-10-01");
    await runScheduledAutomations(userId, "2026-10-15");
    expect(await dates(monthly)).toEqual(["2026-10-01"]);
    await runScheduledAutomations(userId, "2026-11-01");
    expect(await dates(monthly)).toEqual(["2026-10-01", "2026-11-01"]);

    // A day-31 schedule runs on the 31st, or on the last day of shorter months.
    await runScheduledAutomations(userId, "2026-10-30");
    await runScheduledAutomations(userId, "2026-10-31");
    await runScheduledAutomations(userId, "2026-11-29");
    await runScheduledAutomations(userId, "2026-11-30");
    expect(await dates(endOfMonth)).toEqual(["2026-10-31", "2026-11-30"]);
    expect(await prisma.goalContribution.findMany({ where: { automationId: { in: [monthly, endOfMonth] } } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "PLANNED_ALLOCATION", source: "AUTOMATION" })]),
    );
  });
});
