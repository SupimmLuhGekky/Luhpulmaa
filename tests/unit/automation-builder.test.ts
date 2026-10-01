import { describe, expect, it } from "vitest";
import { formatCurrency } from "@/lib/finance/money";
import { actionsForTrigger, automationInputSchema, conditionProblem, normalizeTriggerConfig, type AutomationFormInput } from "@/lib/automation/schemas";
import { describeAction, describeCondition, describeTrigger, ordinal, percentText, type DescribeContext } from "@/lib/automation/describe";
import { scheduledPlannedPerRun, scheduledRunDates, transactionEffects, type EffectContext, type PreviewTransaction } from "@/lib/automation/preview";

const GOAL = "11111111-1111-4111-8111-111111111111";
const CAT_TRANSPORT = "22222222-2222-4222-8222-222222222222";
const CAT_TRANSFER = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "44444444-4444-4444-8444-444444444444";

const money = (cents: number) => formatCurrency(cents, { currency: "CAD", locale: "en-CA", hideZeroCents: true });
const names: Record<string, string> = { [GOAL]: "Car Fund", [CAT_TRANSPORT]: "Transportation", [CAT_TRANSFER]: "Transfers", [ACCOUNT]: "Chequing" };
const ctx: DescribeContext = { categoryName: (id) => names[id], accountName: (id) => names[id], goalName: (id) => names[id], money };
const effectCtx: EffectContext = { categoryName: (id) => names[id], goalName: (id) => names[id], money, isTransferCategory: (id) => id === CAT_TRANSFER };

const base = (over: Partial<AutomationFormInput>): AutomationFormInput => ({
  name: "Test",
  trigger: "TRANSACTION_CREATED",
  actions: [{ type: "ADD_TAG", config: { tagName: "Large purchase" } }],
  ...over,
});

function issues(input: AutomationFormInput) {
  const res = automationInputSchema.safeParse(input);
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("automation validation", () => {
  it("accepts a simple WHEN/THEN rule and trims values", () => {
    const res = automationInputSchema.parse(
      base({ name: "  Uber rides ", conditions: [{ field: "MERCHANT", operator: "CONTAINS", value: " uber " }], actions: [{ type: "SET_CATEGORY", config: { categoryId: CAT_TRANSPORT, extra: "dropped" } }] }),
    );
    expect(res.name).toBe("Uber rides");
    expect(res.conditions[0].value).toBe("uber");
    expect(res.actions[0].config).toEqual({ categoryId: CAT_TRANSPORT });
    expect(res.conditionLogic).toBe("ALL");
    expect(res.isActive).toBe(true);
  });

  it("requires at least one action and a name", () => {
    expect(issues(base({ name: " ", actions: [] }))).toEqual(expect.arrayContaining(["name: Give the automation a name", "actions: Add at least one action"]));
  });

  it("rejects actions the trigger can't run", () => {
    expect(issues(base({ trigger: "INCOME_RECEIVED", actions: [{ type: "ROUND_UP_TO_GOAL", config: { goalId: GOAL } }] }))).toEqual(["actions.0.type: Round-ups only work with new transactions"]);
    expect(issues(base({ trigger: "SCHEDULE_MONTHLY", triggerConfig: { dayOfMonth: 1 }, actions: [{ type: "SET_CATEGORY", config: { categoryId: CAT_TRANSPORT } }] }))).toEqual([
      "actions.0.type: This action needs a transaction trigger",
    ]);
    expect(issues(base({ trigger: "BUDGET_THRESHOLD", triggerConfig: { thresholdPercent: 80 }, actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, amountCents: 1000 } }] }))).toEqual([
      "actions.0.type: This action isn't available for this trigger",
    ]);
  });

  it("needs schedule and threshold settings for those triggers", () => {
    expect(issues(base({ trigger: "SCHEDULE_MONTHLY", actions: [{ type: "NOTIFY", config: { title: "Hi" } }] }))).toEqual(["triggerConfig: Choose a day of the month"]);
    expect(issues(base({ trigger: "SCHEDULE_WEEKLY", actions: [{ type: "NOTIFY", config: { title: "Hi" } }] }))).toEqual(["triggerConfig: Choose a day of the week"]);
    expect(issues(base({ trigger: "BUDGET_THRESHOLD", actions: [{ type: "NOTIFY", config: { title: "Hi" } }] }))).toEqual(["triggerConfig: Choose a threshold"]);
  });

  it("only allows fixed amounts for scheduled allocations", () => {
    expect(issues(base({ trigger: "SCHEDULE_MONTHLY", triggerConfig: { dayOfMonth: 1 }, actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, percentBps: 1000 } }] }))).toEqual([
      "actions.0.config: Scheduled allocations need a fixed amount",
    ]);
  });

  it("validates action settings with friendly messages", () => {
    expect(issues(base({ actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, percentBps: 1000, amountCents: 500 } }] }))).toEqual(["actions.0.config: Choose either a percentage or a fixed amount"]);
    expect(issues(base({ actions: [{ type: "SET_CATEGORY", config: {} }] }))).toEqual(["actions.0.config: Choose a category"]);
    expect(issues(base({ actions: [{ type: "ROUND_UP_TO_GOAL", config: { goalId: GOAL, roundToCents: 250 } }] }))).toEqual(["actions.0.config: Round up to $1, $5 or $10"]);
  });

  it("validates condition values per field and forbids conditions on non-transaction triggers", () => {
    expect(conditionProblem({ field: "AMOUNT", operator: "GREATER_THAN", value: "10000" })).toBeNull();
    expect(conditionProblem({ field: "AMOUNT", operator: "GREATER_THAN", value: "100.50" })).toBe("Enter an amount");
    expect(conditionProblem({ field: "AMOUNT", operator: "CONTAINS", value: "100" })).toBe("This comparison doesn't apply to this field");
    expect(conditionProblem({ field: "CATEGORY", operator: "EQUALS", value: "groceries" })).toBe("Choose a category");
    expect(conditionProblem({ field: "TYPE", operator: "EQUALS", value: "INCOME" })).toBeNull();
    expect(issues(base({ trigger: "SUBSCRIPTION_DETECTED", conditions: [{ field: "MERCHANT", operator: "CONTAINS", value: "x" }], actions: [{ type: "NOTIFY", config: { title: "New" } }] }))).toEqual([
      "conditions: Conditions only apply to transaction triggers",
    ]);
  });

  it("keeps only the trigger options the trigger reads", () => {
    expect(normalizeTriggerConfig("SCHEDULE_MONTHLY", { dayOfMonth: 15, dayOfWeek: 2, thresholdPercent: 80 })).toEqual({ dayOfMonth: 15 });
    expect(normalizeTriggerConfig("TRANSACTION_CREATED", { dayOfMonth: 15 })).toEqual({});
    const parsed = automationInputSchema.parse(base({ trigger: "SCHEDULE_WEEKLY", triggerConfig: { dayOfWeek: 0, dayOfMonth: 3 }, actions: [{ type: "NOTIFY", config: { title: "Weekly check-in" } }] }));
    expect(parsed.triggerConfig).toEqual({ dayOfWeek: 0 });
  });

  it("lists the actions available for each trigger", () => {
    expect(actionsForTrigger("SUBSCRIPTION_DETECTED")).toEqual(["NOTIFY"]);
    expect(actionsForTrigger("SCHEDULE_MONTHLY")).toEqual(["ALLOCATE_TO_GOAL", "NOTIFY"]);
    expect(actionsForTrigger("TRANSACTION_CREATED")).toContain("ROUND_UP_TO_GOAL");
    expect(actionsForTrigger("INCOME_RECEIVED")).not.toContain("ROUND_UP_TO_GOAL");
  });
});

describe("plain-language descriptions", () => {
  it("describes triggers", () => {
    expect(describeTrigger("SCHEDULE_MONTHLY", { dayOfMonth: 1 }, ctx)).toBe("On the 1st of every month");
    expect(describeTrigger("SCHEDULE_MONTHLY", { dayOfMonth: 31 }, ctx)).toBe("On the 31st of every month (or the month's last day)");
    expect(describeTrigger("SCHEDULE_WEEKLY", { dayOfWeek: 5 }, ctx)).toBe("Every Friday");
    expect(describeTrigger("BUDGET_THRESHOLD", { thresholdPercent: 80 }, ctx)).toBe("When any budget category reaches 80% of its budget");
    expect(describeTrigger("BUDGET_THRESHOLD", { thresholdPercent: 90, categoryId: CAT_TRANSPORT }, ctx)).toBe("When Transportation reaches 90% of its budget");
  });

  it("describes conditions with money and names", () => {
    expect(describeCondition({ field: "AMOUNT", operator: "GREATER_THAN", value: "10000" }, ctx)).toBe("Amount is more than $100");
    expect(describeCondition({ field: "MERCHANT", operator: "CONTAINS", value: "Uber" }, ctx)).toBe("Merchant contains “Uber”");
    expect(describeCondition({ field: "ACCOUNT", operator: "EQUALS", value: ACCOUNT }, ctx)).toBe("Account is Chequing");
    expect(describeCondition({ field: "TYPE", operator: "NOT_EQUALS", value: "TRANSFER" }, ctx)).toBe("Type is not transfer");
  });

  it("describes allocations as plans, never as transfers", () => {
    expect(describeAction({ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, percentBps: 2000, aboveCents: 200000 } }, "INCOME_RECEIVED", ctx)).toBe("Plan 20% of the income above $2,000 for Car Fund");
    expect(describeAction({ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, amountCents: 30000 } }, "SCHEDULE_MONTHLY", ctx)).toBe("Plan $300 for Car Fund");
    expect(describeAction({ type: "ROUND_UP_TO_GOAL", config: { goalId: GOAL } }, "TRANSACTION_CREATED", ctx)).toBe("Round up to the next $1 and plan the difference for Car Fund");
    expect(describeAction({ type: "SET_CATEGORY", config: { categoryId: "55555555-5555-4555-8555-555555555555" } }, "TRANSACTION_CREATED", ctx)).toBe("Set the category to a deleted category");
  });

  it("formats ordinals and percentages", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
    expect(percentText(1500)).toBe("15%");
    expect(percentText(1250)).toBe("12.5%");
  });
});

describe("dry-run preview", () => {
  const purchase: PreviewTransaction = { amountCents: -435, categoryId: null, merchantName: "Uber", description: "UBER *TRIP", isTransfer: false };

  it("applies actions in order, like the engine", () => {
    const effects = transactionEffects(
      purchase,
      [
        { type: "SET_CATEGORY", config: { categoryId: CAT_TRANSPORT } },
        { type: "ROUND_UP_TO_GOAL", config: { goalId: GOAL, roundToCents: 100 } },
      ],
      effectCtx,
    );
    expect(effects.map((e) => e.text)).toEqual(["Category → Transportation", "Round-up of $0.65 planned for Car Fund"]);
    expect(effects.reduce((a, e) => a + e.plannedCents, 0)).toBe(65);
  });

  it("skips round-ups once a transaction became a transfer", () => {
    const effects = transactionEffects(purchase, [{ type: "SET_CATEGORY", config: { categoryId: CAT_TRANSFER } }, { type: "ROUND_UP_TO_GOAL", config: { goalId: GOAL } }], effectCtx);
    expect(effects.map((e) => e.type)).toEqual(["SET_CATEGORY"]);
  });

  it("plans only the excess of income above a threshold", () => {
    const paycheque: PreviewTransaction = { amountCents: 250000, categoryId: null, merchantName: "Employer", description: "PAYROLL", isTransfer: false };
    const [effect] = transactionEffects(paycheque, [{ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, percentBps: 2000, aboveCents: 200000 } }], effectCtx);
    expect(effect).toEqual({ type: "ALLOCATE_TO_GOAL", text: "Plan $100 for Car Fund", plannedCents: 10000 });
    expect(transactionEffects({ ...paycheque, amountCents: 150000 }, [{ type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, percentBps: 2000, aboveCents: 200000 } }], effectCtx)).toEqual([]);
  });

  it("does not report changes that wouldn't change anything", () => {
    expect(transactionEffects({ ...purchase, categoryId: CAT_TRANSPORT }, [{ type: "SET_CATEGORY", config: { categoryId: CAT_TRANSPORT } }], effectCtx)).toEqual([]);
    expect(transactionEffects({ ...purchase, amountCents: -500 }, [{ type: "ROUND_UP_TO_GOAL", config: { goalId: GOAL } }], effectCtx)).toEqual([]);
  });

  it("lists scheduled run dates, clamping to short months", () => {
    expect(scheduledRunDates("SCHEDULE_MONTHLY", { dayOfMonth: 31 }, "2026-01-15", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(scheduledRunDates("SCHEDULE_WEEKLY", { dayOfWeek: 5 }, "2026-09-01", "2026-09-30")).toEqual(["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
    expect(scheduledRunDates("SCHEDULE_MONTHLY", {}, "2026-01-01", "2026-03-01")).toEqual([]);
  });

  it("sums the fixed amounts a scheduled run would plan", () => {
    expect(
      scheduledPlannedPerRun([
        { type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, amountCents: 30000 } },
        { type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, amountCents: 5000 } },
        { type: "NOTIFY", config: { title: "Saved" } },
      ]),
    ).toBe(35000);
  });
});
