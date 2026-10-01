import { describe, expect, it } from "vitest";
import { allocationAmount, evaluateCondition, evaluateConditions, roundUpAmount, type Condition, type EvaluableTransaction } from "@/lib/automation/conditions";
import { automationInputSchema } from "@/lib/automation/schemas";

const GOAL = "00000000-0000-4000-8000-000000000001";
const CATEGORY = "00000000-0000-4000-8000-000000000002";

const txn: EvaluableTransaction = {
  merchantName: "Metro",
  description: "METRO PLUS #123 MONTREAL QC",
  amountCents: -12000,
  categoryId: "cat-groceries",
  accountId: "acct-chequing",
  type: "EXPENSE",
};

const c = (field: Condition["field"], operator: Condition["operator"], value: string): Condition => ({ field, operator, value });

describe("evaluateCondition: text fields", () => {
  it("compares merchants by their normalised key", () => {
    expect(evaluateCondition(txn, c("MERCHANT", "EQUALS", "metro"))).toBe(true);
    expect(evaluateCondition(txn, c("MERCHANT", "EQUALS", "METRO #999"))).toBe(true);
    expect(evaluateCondition(txn, c("MERCHANT", "NOT_EQUALS", "IGA"))).toBe(true);
    expect(evaluateCondition(txn, c("MERCHANT", "NOT_EQUALS", "Metro"))).toBe(false);
    expect(evaluateCondition(txn, c("MERCHANT", "CONTAINS", "etr"))).toBe(true);
    expect(evaluateCondition(txn, c("MERCHANT", "STARTS_WITH", "met"))).toBe(true);
    expect(evaluateCondition(txn, c("MERCHANT", "STARTS_WITH", "etro"))).toBe(false);
  });

  it("falls back to the description when there is no merchant name", () => {
    const t = { ...txn, merchantName: null };
    expect(evaluateCondition(t, c("MERCHANT", "CONTAINS", "metro plus"))).toBe(true);
  });

  it("matches descriptions case- and accent-insensitively", () => {
    const t = { ...txn, merchantName: null, description: "HYDRO-QUÉBEC 0001" };
    expect(evaluateCondition(t, c("DESCRIPTION", "CONTAINS", "hydro"))).toBe(true);
    expect(evaluateCondition(t, c("DESCRIPTION", "STARTS_WITH", "Hydro"))).toBe(true);
  });

  it("does not support numeric operators on text", () => {
    expect(evaluateCondition(txn, c("MERCHANT", "GREATER_THAN", "a"))).toBe(false);
  });

  it("matches description words that merchant keys drop (Interac, payment)", () => {
    const etransfer = { ...txn, merchantName: null, description: "INTERAC E-TRANSFER TO J TREMBLAY", amountCents: -60000 };
    expect(evaluateCondition(etransfer, c("DESCRIPTION", "CONTAINS", "Interac"))).toBe(true);
    expect(evaluateCondition(etransfer, c("DESCRIPTION", "STARTS_WITH", "Interac e-transfer"))).toBe(true);
  });

  it("matches 'payment' in a card payment description", () => {
    const payment = { ...txn, merchantName: null, description: "VISA PAYMENT - CASHBACK VISA", amountCents: -50000 };
    expect(evaluateCondition(payment, c("DESCRIPTION", "CONTAINS", "payment"))).toBe(true);
  });
});

describe("evaluateCondition: amount", () => {
  it("compares the absolute amount in cents", () => {
    expect(evaluateCondition(txn, c("AMOUNT", "GREATER_THAN", "10000"))).toBe(true);
    expect(evaluateCondition(txn, c("AMOUNT", "GREATER_THAN", "12000"))).toBe(false);
    expect(evaluateCondition(txn, c("AMOUNT", "GREATER_THAN_OR_EQUAL", "12000"))).toBe(true);
    expect(evaluateCondition(txn, c("AMOUNT", "LESS_THAN", "12000"))).toBe(false);
    expect(evaluateCondition(txn, c("AMOUNT", "LESS_THAN_OR_EQUAL", "12000"))).toBe(true);
    expect(evaluateCondition(txn, c("AMOUNT", "EQUALS", "12000"))).toBe(true);
    expect(evaluateCondition(txn, c("AMOUNT", "NOT_EQUALS", "12000"))).toBe(false);
    expect(evaluateCondition({ ...txn, amountCents: 12000 }, c("AMOUNT", "EQUALS", "12000"))).toBe(true);
  });

  it("never matches a non-integer or non-numeric amount, or a text operator", () => {
    expect(evaluateCondition(txn, c("AMOUNT", "GREATER_THAN", "100.50"))).toBe(false);
    expect(evaluateCondition(txn, c("AMOUNT", "GREATER_THAN", "abc"))).toBe(false);
    expect(evaluateCondition(txn, c("AMOUNT", "CONTAINS", "120"))).toBe(false);
  });
});

describe("evaluateCondition: ids and type", () => {
  it("matches category, account and type by equality", () => {
    expect(evaluateCondition(txn, c("CATEGORY", "EQUALS", "cat-groceries"))).toBe(true);
    expect(evaluateCondition(txn, c("CATEGORY", "NOT_EQUALS", "cat-groceries"))).toBe(false);
    expect(evaluateCondition({ ...txn, categoryId: null }, c("CATEGORY", "NOT_EQUALS", "cat-groceries"))).toBe(true);
    expect(evaluateCondition(txn, c("ACCOUNT", "EQUALS", "acct-chequing"))).toBe(true);
    expect(evaluateCondition(txn, c("ACCOUNT", "NOT_EQUALS", "acct-chequing"))).toBe(false);
    expect(evaluateCondition(txn, c("TYPE", "EQUALS", "EXPENSE"))).toBe(true);
    expect(evaluateCondition(txn, c("TYPE", "NOT_EQUALS", "INCOME"))).toBe(true);
  });
});

describe("evaluateConditions", () => {
  const yes = c("MERCHANT", "EQUALS", "metro");
  const no = c("AMOUNT", "GREATER_THAN", "50000");

  it("ALL needs every condition, ANY needs one", () => {
    expect(evaluateConditions(txn, [yes, no], "ALL")).toBe(false);
    expect(evaluateConditions(txn, [yes, no], "ANY")).toBe(true);
    expect(evaluateConditions(txn, [yes], "ALL")).toBe(true);
    expect(evaluateConditions(txn, [no], "ANY")).toBe(false);
  });

  it("matches every transaction when there are no conditions", () => {
    expect(evaluateConditions(txn, [], "ALL")).toBe(true);
    expect(evaluateConditions(txn, [], "ANY")).toBe(true);
  });
});

describe("allocationAmount (planned allocations only)", () => {
  it("takes a percentage, rounding half up", () => {
    expect(allocationAmount(142000, { percentBps: 1000 })).toBe(14200);
    expect(allocationAmount(100, { percentBps: 3333 })).toBe(33);
    expect(allocationAmount(15, { percentBps: 3333 })).toBe(5);
  });

  it("takes a fixed amount capped at the income", () => {
    expect(allocationAmount(142000, { amountCents: 50000 })).toBe(50000);
    expect(allocationAmount(142000, { amountCents: 500000 })).toBe(142000);
  });

  it("only counts income above the threshold", () => {
    expect(allocationAmount(142000, { aboveCents: 100000, percentBps: 5000 })).toBe(21000);
    expect(allocationAmount(142000, { aboveCents: 142000, percentBps: 5000 })).toBe(0);
    expect(allocationAmount(142000, { aboveCents: 100000, amountCents: 50000 })).toBe(42000);
  });

  it("is zero without a rule or without income", () => {
    expect(allocationAmount(142000, {})).toBe(0);
    expect(allocationAmount(0, { percentBps: 1000 })).toBe(0);
    expect(allocationAmount(-5000, { amountCents: 1000 })).toBe(0);
  });
});

describe("roundUpAmount", () => {
  it("rounds purchases up to the next dollar (or $5 / $10)", () => {
    expect(roundUpAmount(-435)).toBe(65);
    expect(roundUpAmount(-1)).toBe(99);
    expect(roundUpAmount(-435, 500)).toBe(65);
    expect(roundUpAmount(-435, 1000)).toBe(565);
  });

  it("is zero for exact amounts and inflows", () => {
    expect(roundUpAmount(-400)).toBe(0);
    expect(roundUpAmount(435)).toBe(0);
    expect(roundUpAmount(0)).toBe(0);
  });
});

describe("automationInputSchema", () => {
  const base = { name: "Coffee round-ups", trigger: "TRANSACTION_CREATED", actions: [{ type: "ROUND_UP_TO_GOAL", config: { goalId: GOAL } }] };

  it("accepts a transaction automation and fills defaults", () => {
    const parsed = automationInputSchema.parse({ ...base, conditions: [{ field: "MERCHANT", operator: "CONTAINS", value: " Tim Hortons " }] });
    expect(parsed).toMatchObject({ conditionLogic: "ALL", isActive: true, triggerConfig: {}, conditions: [{ value: "Tim Hortons" }] });
  });

  it("rejects round-up steps other than $1, $5 and $10", () => {
    expect(automationInputSchema.safeParse({ ...base, actions: [{ type: "ROUND_UP_TO_GOAL", config: { goalId: GOAL, roundToCents: 250 } }] }).success).toBe(false);
  });

  it("requires exactly one of percentage or fixed amount for goal allocations", () => {
    const alloc = (config: Record<string, unknown>) => automationInputSchema.safeParse({ ...base, trigger: "INCOME_RECEIVED", actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, ...config } }] }).success;
    expect(alloc({ percentBps: 1000 })).toBe(true);
    expect(alloc({ amountCents: 5000 })).toBe(true);
    expect(alloc({})).toBe(false);
    expect(alloc({ percentBps: 1000, amountCents: 5000 })).toBe(false);
  });

  it("validates scheduled triggers", () => {
    const monthly = { name: "Monthly savings", trigger: "SCHEDULE_MONTHLY", actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, amountCents: 20000 } }] };
    expect(automationInputSchema.safeParse(monthly).success).toBe(false); // no day of month
    expect(automationInputSchema.safeParse({ ...monthly, triggerConfig: { dayOfMonth: 31 } }).success).toBe(true);
    expect(automationInputSchema.safeParse({ ...monthly, triggerConfig: { dayOfMonth: 32 } }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...monthly, triggerConfig: { dayOfMonth: 1 }, actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, percentBps: 1000 } }] }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...monthly, triggerConfig: { dayOfMonth: 1 }, conditions: [{ field: "AMOUNT", operator: "GREATER_THAN", value: "1" }] }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...monthly, triggerConfig: { dayOfMonth: 1 }, actions: [{ type: "SET_CATEGORY", config: { categoryId: CATEGORY } }] }).success).toBe(false);
  });

  it("requires at least one action and a name", () => {
    expect(automationInputSchema.safeParse({ ...base, actions: [] }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
  });
});
