import { z } from "zod";

/** zod schemas for the JSON columns of the automation engine. */
export const conditionFieldSchema = z.enum(["MERCHANT", "DESCRIPTION", "AMOUNT", "CATEGORY", "ACCOUNT", "TYPE"]);
export const conditionOperatorSchema = z.enum([
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "STARTS_WITH",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
]);

export type ConditionField = z.infer<typeof conditionFieldSchema>;
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

export const triggerSchema = z.enum(["TRANSACTION_CREATED", "INCOME_RECEIVED", "SCHEDULE_MONTHLY", "SCHEDULE_WEEKLY", "SUBSCRIPTION_DETECTED", "BUDGET_THRESHOLD"]);
export type Trigger = z.infer<typeof triggerSchema>;

/** Triggers that run on a transaction (the only ones that can have conditions). */
export const TRANSACTION_TRIGGERS: readonly Trigger[] = ["TRANSACTION_CREATED", "INCOME_RECEIVED"];
export const SCHEDULE_TRIGGERS: readonly Trigger[] = ["SCHEDULE_MONTHLY", "SCHEDULE_WEEKLY"];

export function isTransactionTrigger(trigger: Trigger): boolean {
  return TRANSACTION_TRIGGERS.includes(trigger);
}

/** Transaction types a TYPE condition can compare against (mirrors the TransactionType enum). */
export const CONDITION_TRANSACTION_TYPES = ["INCOME", "EXPENSE", "TRANSFER", "REFUND", "ADJUSTMENT"] as const;

/** Operators that make sense for each field (the engine returns false for any other pairing). */
export const FIELD_OPERATORS: Record<ConditionField, readonly ConditionOperator[]> = {
  MERCHANT: ["EQUALS", "NOT_EQUALS", "CONTAINS", "STARTS_WITH"],
  DESCRIPTION: ["EQUALS", "NOT_EQUALS", "CONTAINS", "STARTS_WITH"],
  AMOUNT: ["GREATER_THAN", "GREATER_THAN_OR_EQUAL", "LESS_THAN", "LESS_THAN_OR_EQUAL", "EQUALS", "NOT_EQUALS"],
  CATEGORY: ["EQUALS", "NOT_EQUALS"],
  ACCOUNT: ["EQUALS", "NOT_EQUALS"],
  TYPE: ["EQUALS", "NOT_EQUALS"],
};

export const triggerConfigSchema = z
  .object({
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    thresholdPercent: z.number().int().min(1).max(500).optional(),
    categoryId: z.string().uuid().optional(),
  })
  .strict();

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

/** Keeps only the trigger options that the chosen trigger actually reads. */
export function normalizeTriggerConfig(trigger: Trigger, config: TriggerConfig): TriggerConfig {
  switch (trigger) {
    case "SCHEDULE_MONTHLY":
      return config.dayOfMonth !== undefined ? { dayOfMonth: config.dayOfMonth } : {};
    case "SCHEDULE_WEEKLY":
      return config.dayOfWeek !== undefined ? { dayOfWeek: config.dayOfWeek } : {};
    case "BUDGET_THRESHOLD":
      return {
        ...(config.thresholdPercent !== undefined ? { thresholdPercent: config.thresholdPercent } : {}),
        ...(config.categoryId ? { categoryId: config.categoryId } : {}),
      };
    default:
      return {};
  }
}

export const ROUND_UP_CHOICES = [100, 500, 1000] as const;

export const actionConfigSchemas = {
  SET_CATEGORY: z.object({ categoryId: z.string({ required_error: "Choose a category" }).uuid("Choose a category"), subcategoryId: z.string().uuid().nullable().optional() }),
  ADD_TAG: z.object({ tagName: z.string({ required_error: "Enter a tag" }).trim().min(1, "Enter a tag").max(40) }),
  MARK_TRANSFER: z.object({}),
  MARK_RECURRING: z.object({}),
  SET_NOTE: z.object({ note: z.string({ required_error: "Enter a note" }).trim().min(1, "Enter a note").max(500) }),
  RENAME_MERCHANT: z.object({ merchantName: z.string({ required_error: "Enter a merchant name" }).trim().min(1, "Enter a merchant name").max(80) }),
  ALLOCATE_TO_GOAL: z
    .object({
      goalId: z.string({ required_error: "Choose a goal" }).uuid("Choose a goal"),
      percentBps: z.number().int().min(1).max(10000).optional(),
      amountCents: z.number().int().positive().max(100_000_000).optional(),
      /** Only the portion of the income above this amount counts ("20% of the excess over $2,000"). */
      aboveCents: z.number().int().nonnegative().max(100_000_000).optional(),
    })
    .refine((v) => (v.percentBps ? 1 : 0) + (v.amountCents ? 1 : 0) === 1, "Choose either a percentage or a fixed amount"),
  ROUND_UP_TO_GOAL: z.object({
    goalId: z.string({ required_error: "Choose a goal" }).uuid("Choose a goal"),
    roundToCents: z
      .number()
      .int()
      .refine((v) => (ROUND_UP_CHOICES as readonly number[]).includes(v), "Round up to $1, $5 or $10")
      .default(100),
  }),
  NOTIFY: z.object({ title: z.string({ required_error: "Enter a title" }).trim().min(1, "Enter a title").max(100), message: z.string().trim().max(300).optional() }),
} as const;

export type ActionType = keyof typeof actionConfigSchemas;
export const actionTypeSchema = z.enum(Object.keys(actionConfigSchemas) as [ActionType, ...ActionType[]]);

/**
 * Which triggers each action works with — mirrors what lib/automation/engine executes:
 * transaction edits need a transaction, scheduled runs only plan fixed amounts or notify,
 * and subscription/budget events only notify.
 */
export const ACTION_TRIGGERS: Record<ActionType, readonly Trigger[]> = {
  SET_CATEGORY: TRANSACTION_TRIGGERS,
  ADD_TAG: TRANSACTION_TRIGGERS,
  MARK_TRANSFER: TRANSACTION_TRIGGERS,
  MARK_RECURRING: TRANSACTION_TRIGGERS,
  SET_NOTE: TRANSACTION_TRIGGERS,
  RENAME_MERCHANT: TRANSACTION_TRIGGERS,
  ALLOCATE_TO_GOAL: ["TRANSACTION_CREATED", "INCOME_RECEIVED", "SCHEDULE_MONTHLY", "SCHEDULE_WEEKLY"],
  ROUND_UP_TO_GOAL: ["TRANSACTION_CREATED"],
  NOTIFY: triggerSchema.options,
};

export function actionsForTrigger(trigger: Trigger): ActionType[] {
  return actionTypeSchema.options.filter((t) => ACTION_TRIGGERS[t].includes(trigger));
}

export const conditionInputSchema = z.object({
  field: conditionFieldSchema,
  operator: conditionOperatorSchema,
  value: z.string().trim().min(1, "Enter a value").max(200),
});

export type ConditionInput = z.infer<typeof conditionInputSchema>;

/** Field-specific checks for one condition. Returns an error message, or null when valid. */
export function conditionProblem(c: ConditionInput): string | null {
  if (!FIELD_OPERATORS[c.field].includes(c.operator)) return "This comparison doesn't apply to this field";
  switch (c.field) {
    case "AMOUNT":
      return /^\d{1,12}$/.test(c.value) ? null : "Enter an amount";
    case "CATEGORY":
      return z.string().uuid().safeParse(c.value).success ? null : "Choose a category";
    case "ACCOUNT":
      return z.string().uuid().safeParse(c.value).success ? null : "Choose an account";
    case "TYPE":
      return (CONDITION_TRANSACTION_TYPES as readonly string[]).includes(c.value) ? null : "Choose a transaction type";
    default:
      return null;
  }
}

/** Validates the action settings and stores only the parsed (trimmed, defaulted, known-keys-only) config. */
export const actionInputSchema = z
  .object({ type: actionTypeSchema, config: z.record(z.unknown()).default({}) })
  .superRefine((a, ctx) => {
    const res = actionConfigSchemas[a.type].safeParse(a.config);
    if (!res.success) ctx.addIssue({ code: "custom", message: res.error.issues[0]?.message ?? "Invalid action settings", path: ["config"] });
  })
  .transform((a) => ({ type: a.type, config: actionConfigSchemas[a.type].parse(a.config) as Record<string, unknown> }));

export type ActionInput = z.input<typeof actionInputSchema>;

export const automationInputSchema = z
  .object({
    name: z.string().trim().min(1, "Give the automation a name").max(80),
    description: z.string().trim().max(300).optional().nullable(),
    trigger: triggerSchema,
    triggerConfig: triggerConfigSchema.default({}),
    conditionLogic: z.enum(["ALL", "ANY"]).default("ALL"),
    isActive: z.boolean().default(true),
    conditions: z.array(conditionInputSchema).max(10, "Use at most 10 conditions").default([]),
    actions: z.array(actionInputSchema).min(1, "Add at least one action").max(10, "Use at most 10 actions"),
  })
  .superRefine((a, ctx) => {
    const txnTrigger = isTransactionTrigger(a.trigger);
    for (const [i, action] of a.actions.entries()) {
      if (!ACTION_TRIGGERS[action.type].includes(a.trigger)) {
        const needsTxn = ACTION_TRIGGERS[action.type].every((t) => isTransactionTrigger(t));
        ctx.addIssue({
          code: "custom",
          path: ["actions", i, "type"],
          message: action.type === "ROUND_UP_TO_GOAL" ? "Round-ups only work with new transactions" : needsTxn ? "This action needs a transaction trigger" : "This action isn't available for this trigger",
        });
      }
      if (action.type === "ALLOCATE_TO_GOAL" && SCHEDULE_TRIGGERS.includes(a.trigger) && !(action.config as { amountCents?: number }).amountCents) {
        ctx.addIssue({ code: "custom", path: ["actions", i, "config"], message: "Scheduled allocations need a fixed amount" });
      }
    }
    if (a.trigger === "SCHEDULE_MONTHLY" && !a.triggerConfig.dayOfMonth) ctx.addIssue({ code: "custom", path: ["triggerConfig"], message: "Choose a day of the month" });
    if (a.trigger === "SCHEDULE_WEEKLY" && a.triggerConfig.dayOfWeek === undefined) ctx.addIssue({ code: "custom", path: ["triggerConfig"], message: "Choose a day of the week" });
    if (a.trigger === "BUDGET_THRESHOLD" && !a.triggerConfig.thresholdPercent) ctx.addIssue({ code: "custom", path: ["triggerConfig"], message: "Choose a threshold" });
    if (!txnTrigger && a.conditions.length) ctx.addIssue({ code: "custom", path: ["conditions"], message: "Conditions only apply to transaction triggers" });
    for (const [i, c] of a.conditions.entries()) {
      const problem = conditionProblem(c);
      if (problem) ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: problem });
    }
  })
  .transform((a) => ({ ...a, triggerConfig: normalizeTriggerConfig(a.trigger, a.triggerConfig) }));

export type AutomationInput = z.infer<typeof automationInputSchema>;
export type AutomationFormInput = z.input<typeof automationInputSchema>;
