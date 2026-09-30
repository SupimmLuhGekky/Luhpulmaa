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

export const triggerSchema = z.enum(["TRANSACTION_CREATED", "INCOME_RECEIVED", "SCHEDULE_MONTHLY", "SCHEDULE_WEEKLY", "SUBSCRIPTION_DETECTED", "BUDGET_THRESHOLD"]);

export const triggerConfigSchema = z
  .object({
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    thresholdPercent: z.number().int().min(1).max(500).optional(),
    categoryId: z.string().uuid().optional(),
  })
  .strict();

export const actionConfigSchemas = {
  SET_CATEGORY: z.object({ categoryId: z.string().uuid(), subcategoryId: z.string().uuid().nullable().optional() }),
  ADD_TAG: z.object({ tagName: z.string().trim().min(1).max(40) }),
  MARK_TRANSFER: z.object({}),
  MARK_RECURRING: z.object({}),
  SET_NOTE: z.object({ note: z.string().trim().min(1).max(500) }),
  RENAME_MERCHANT: z.object({ merchantName: z.string().trim().min(1).max(80) }),
  ALLOCATE_TO_GOAL: z
    .object({
      goalId: z.string().uuid(),
      percentBps: z.number().int().min(1).max(10000).optional(),
      amountCents: z.number().int().positive().optional(),
      /** Only the portion of the income above this amount counts ("20% of the excess over $2,000"). */
      aboveCents: z.number().int().nonnegative().optional(),
    })
    .refine((v) => (v.percentBps ? 1 : 0) + (v.amountCents ? 1 : 0) === 1, "Choose either a percentage or a fixed amount"),
  ROUND_UP_TO_GOAL: z.object({ goalId: z.string().uuid(), roundToCents: z.number().int().refine((v) => [100, 500, 1000].includes(v)).default(100) }),
  NOTIFY: z.object({ title: z.string().trim().min(1).max(100), message: z.string().trim().max(300).optional() }),
} as const;

export type ActionType = keyof typeof actionConfigSchemas;
export const actionTypeSchema = z.enum(Object.keys(actionConfigSchemas) as [ActionType, ...ActionType[]]);

export const conditionInputSchema = z.object({
  field: conditionFieldSchema,
  operator: conditionOperatorSchema,
  value: z.string().trim().min(1).max(200),
});

export const actionInputSchema = z
  .object({ type: actionTypeSchema, config: z.record(z.unknown()).default({}) })
  .superRefine((a, ctx) => {
    const res = actionConfigSchemas[a.type].safeParse(a.config);
    if (!res.success) ctx.addIssue({ code: "custom", message: res.error.issues[0]?.message ?? "Invalid action settings", path: ["config"] });
  });

export const automationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).optional().nullable(),
    trigger: triggerSchema,
    triggerConfig: triggerConfigSchema.default({}),
    conditionLogic: z.enum(["ALL", "ANY"]).default("ALL"),
    isActive: z.boolean().default(true),
    conditions: z.array(conditionInputSchema).max(10).default([]),
    actions: z.array(actionInputSchema).min(1, "Add at least one action").max(10),
  })
  .superRefine((a, ctx) => {
    const txnTrigger = a.trigger === "TRANSACTION_CREATED" || a.trigger === "INCOME_RECEIVED";
    const txnOnly: ActionType[] = ["SET_CATEGORY", "ADD_TAG", "MARK_TRANSFER", "MARK_RECURRING", "SET_NOTE", "RENAME_MERCHANT", "ROUND_UP_TO_GOAL"];
    for (const [i, action] of a.actions.entries()) {
      if (!txnTrigger && txnOnly.includes(action.type)) {
        ctx.addIssue({ code: "custom", path: ["actions", i, "type"], message: "This action needs a transaction trigger" });
      }
      if (action.type === "ALLOCATE_TO_GOAL" && (a.trigger === "SCHEDULE_MONTHLY" || a.trigger === "SCHEDULE_WEEKLY") && !(action.config as { amountCents?: number }).amountCents) {
        ctx.addIssue({ code: "custom", path: ["actions", i, "config"], message: "Scheduled allocations need a fixed amount" });
      }
    }
    if (a.trigger === "SCHEDULE_MONTHLY" && !a.triggerConfig.dayOfMonth) ctx.addIssue({ code: "custom", path: ["triggerConfig"], message: "Choose a day of the month" });
    if (a.trigger === "SCHEDULE_WEEKLY" && a.triggerConfig.dayOfWeek === undefined) ctx.addIssue({ code: "custom", path: ["triggerConfig"], message: "Choose a day of the week" });
    if (a.trigger === "BUDGET_THRESHOLD" && !a.triggerConfig.thresholdPercent) ctx.addIssue({ code: "custom", path: ["triggerConfig"], message: "Choose a threshold" });
    if (!txnTrigger && a.conditions.length) ctx.addIssue({ code: "custom", path: ["conditions"], message: "Conditions only apply to transaction triggers" });
  });

export type AutomationInput = z.infer<typeof automationInputSchema>;
