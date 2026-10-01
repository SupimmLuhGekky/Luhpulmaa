/**
 * Plain-language descriptions of automations ("When income arrives → plan 20% for Car Fund").
 * Pure and client-safe: names and money formatting come from the caller.
 */
import { formatBps } from "@/lib/finance/money";
import { actionConfigSchemas, type ActionType, type ConditionField, type ConditionOperator, type Trigger, type TriggerConfig } from "./schemas";

export interface DescribeContext {
  categoryName: (id: string) => string | undefined;
  accountName: (id: string) => string | undefined;
  goalName: (id: string) => string | undefined;
  money: (cents: number) => string;
  locale?: string;
}

export const TRIGGER_INFO: Record<Trigger, { label: string; description: string; group: "transaction" | "schedule" | "event" }> = {
  TRANSACTION_CREATED: { label: "A transaction is added", description: "Each new transaction from a bank sync, a CSV import or manual entry.", group: "transaction" },
  INCOME_RECEIVED: { label: "Income arrives", description: "Each paycheque or other deposit recorded as income.", group: "transaction" },
  SCHEDULE_MONTHLY: { label: "Every month", description: "Once a month, on the day you choose.", group: "schedule" },
  SCHEDULE_WEEKLY: { label: "Every week", description: "Once a week, on the day you choose.", group: "schedule" },
  SUBSCRIPTION_DETECTED: { label: "A new subscription is detected", description: "When Harbour spots a new recurring charge.", group: "event" },
  BUDGET_THRESHOLD: { label: "A budget reaches a threshold", description: "When spending in a budget category crosses a percentage.", group: "event" },
};

export const FIELD_LABELS: Record<ConditionField, string> = {
  MERCHANT: "Merchant",
  DESCRIPTION: "Description",
  AMOUNT: "Amount",
  CATEGORY: "Category",
  ACCOUNT: "Account",
  TYPE: "Type",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  EQUALS: "is",
  NOT_EQUALS: "is not",
  CONTAINS: "contains",
  STARTS_WITH: "starts with",
  GREATER_THAN: "is more than",
  GREATER_THAN_OR_EQUAL: "is at least",
  LESS_THAN: "is less than",
  LESS_THAN_OR_EQUAL: "is at most",
};

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  INCOME: "Income",
  EXPENSE: "Expense",
  TRANSFER: "Transfer",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
};

export const ACTION_INFO: Record<ActionType, { label: string; description: string; plansMoney?: boolean }> = {
  SET_CATEGORY: { label: "Set the category", description: "Recategorise the transaction." },
  ADD_TAG: { label: "Add a tag", description: "Label it so you can filter and report on it later." },
  MARK_TRANSFER: { label: "Mark as a transfer", description: "Leave it out of spending and income totals." },
  MARK_RECURRING: { label: "Mark as recurring", description: "Flag it as a repeating charge or deposit." },
  SET_NOTE: { label: "Add a note", description: "Attach a note to the transaction." },
  RENAME_MERCHANT: { label: "Rename the merchant", description: "Show a cleaner merchant name." },
  ALLOCATE_TO_GOAL: { label: "Plan money for a goal", description: "Records a planned allocation toward a savings goal. No money is moved.", plansMoney: true },
  ROUND_UP_TO_GOAL: { label: "Round up for a goal", description: "Plans each purchase's spare change for a goal. No money is moved.", plansMoney: true },
  NOTIFY: { label: "Send me a notification", description: "Shows up in your notification centre." },
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function percentText(bps: number, locale = "en-CA"): string {
  return formatBps(bps, bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2, locale);
}

/** "On the 1st of every month", "Every Friday", "When Restaurants reaches 80% of its budget". */
export function describeTrigger(trigger: Trigger, config: TriggerConfig, ctx: Pick<DescribeContext, "categoryName">): string {
  switch (trigger) {
    case "TRANSACTION_CREATED":
      return "When a transaction is added";
    case "INCOME_RECEIVED":
      return "When income arrives";
    case "SCHEDULE_MONTHLY": {
      const day = config.dayOfMonth;
      if (!day) return "Every month";
      return day >= 29 ? `On the ${ordinal(day)} of every month (or the month's last day)` : `On the ${ordinal(day)} of every month`;
    }
    case "SCHEDULE_WEEKLY":
      return config.dayOfWeek === undefined ? "Every week" : `Every ${WEEKDAYS[config.dayOfWeek]}`;
    case "SUBSCRIPTION_DETECTED":
      return "When a new subscription is detected";
    case "BUDGET_THRESHOLD": {
      const what = config.categoryId ? (ctx.categoryName(config.categoryId) ?? "a deleted category") : "any budget category";
      return config.thresholdPercent ? `When ${what} reaches ${config.thresholdPercent}% of its budget` : `When ${what} reaches a threshold`;
    }
  }
}

/** "Merchant contains “Uber”", "Amount is more than $100.00", "Category is Groceries". */
export function describeCondition(c: { field: ConditionField; operator: ConditionOperator; value: string }, ctx: DescribeContext): string {
  const op = OPERATOR_LABELS[c.operator];
  if (!c.value.trim()) return `${FIELD_LABELS[c.field]} ${op} …`;
  switch (c.field) {
    case "AMOUNT":
      return /^\d+$/.test(c.value) ? `Amount ${op} ${ctx.money(Number(c.value))}` : `Amount ${op} …`;
    case "CATEGORY":
      return `Category ${op} ${ctx.categoryName(c.value) ?? "a deleted category"}`;
    case "ACCOUNT":
      return `Account ${op} ${ctx.accountName(c.value) ?? "a removed account"}`;
    case "TYPE":
      return `Type ${op} ${(TRANSACTION_TYPE_LABELS[c.value] ?? c.value).toLowerCase()}`;
    default:
      return `${FIELD_LABELS[c.field]} ${op} “${c.value}”`;
  }
}

/** "Set the category to Transportation", "Plan 20% of the income for Car Fund". */
export function describeAction(a: { type: ActionType; config: Record<string, unknown> }, trigger: Trigger, ctx: DescribeContext): string {
  const parsed = actionConfigSchemas[a.type].safeParse(a.config);
  const cfg = (parsed.success ? parsed.data : a.config) as Record<string, unknown>;
  const goal = typeof cfg.goalId === "string" ? (ctx.goalName(cfg.goalId) ?? "a deleted goal") : "a goal";
  switch (a.type) {
    case "SET_CATEGORY":
      return typeof cfg.categoryId === "string" ? `Set the category to ${ctx.categoryName(cfg.categoryId) ?? "a deleted category"}` : "Set the category";
    case "ADD_TAG":
      return cfg.tagName ? `Add the tag “${String(cfg.tagName)}”` : "Add a tag";
    case "MARK_TRANSFER":
      return "Mark it as a transfer";
    case "MARK_RECURRING":
      return "Mark it as recurring";
    case "SET_NOTE":
      return cfg.note ? `Add the note “${String(cfg.note)}”` : "Add a note";
    case "RENAME_MERCHANT":
      return cfg.merchantName ? `Rename the merchant to “${String(cfg.merchantName)}”` : "Rename the merchant";
    case "ALLOCATE_TO_GOAL": {
      if (typeof cfg.amountCents === "number" && cfg.amountCents > 0) return `Plan ${ctx.money(cfg.amountCents)} for ${goal}`;
      if (typeof cfg.percentBps === "number" && cfg.percentBps > 0) {
        const base = trigger === "INCOME_RECEIVED" ? "the income" : "the amount";
        const above = typeof cfg.aboveCents === "number" && cfg.aboveCents > 0 ? ` above ${ctx.money(cfg.aboveCents)}` : "";
        return `Plan ${percentText(cfg.percentBps, ctx.locale)} of ${base}${above} for ${goal}`;
      }
      return `Plan money for ${goal}`;
    }
    case "ROUND_UP_TO_GOAL": {
      const to = typeof cfg.roundToCents === "number" ? cfg.roundToCents : 100;
      return `Round up to the next ${ctx.money(to)} and plan the difference for ${goal}`;
    }
    case "NOTIFY":
      return cfg.title ? `Notify me: “${String(cfg.title)}”` : "Send me a notification";
  }
}
