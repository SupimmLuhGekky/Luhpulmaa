/**
 * Initial values for the automation builder (server-safe: used by the pages to prefill
 * a new automation, a template or an existing automation).
 */
import type { ActionType, ConditionField, ConditionOperator, Trigger, TriggerConfig } from "@/lib/automation/schemas";
import { SCHEDULE_TRIGGERS } from "@/lib/automation/schemas";

/** Names the builder and the list need to describe automations (all owned by the user). */
export interface AutomationOptions {
  categories: { id: string; name: string; kind: "EXPENSE" | "INCOME" | "TRANSFER"; icon: string; color: string; isHidden: boolean; systemKey: string | null; subcategories: { id: string; name: string }[] }[];
  accounts: { id: string; name: string }[];
  goals: { id: string; name: string; status: string }[];
}

export interface BuilderValues {
  name: string;
  description: string;
  trigger: Trigger;
  triggerConfig: TriggerConfig;
  conditionLogic: "ALL" | "ANY";
  isActive: boolean;
  conditions: { field: ConditionField; operator: ConditionOperator; value: string }[];
  actions: { type: ActionType; config: Record<string, unknown> }[];
}

export function emptyBuilderValues(): BuilderValues {
  return {
    name: "",
    description: "",
    trigger: "TRANSACTION_CREATED",
    triggerConfig: {},
    conditionLogic: "ALL",
    isActive: true,
    conditions: [{ field: "MERCHANT", operator: "CONTAINS", value: "" }],
    actions: [{ type: "SET_CATEGORY", config: {} }],
  };
}

export function valuesFromAutomation(a: {
  name: string;
  description: string | null;
  trigger: Trigger;
  triggerConfig: TriggerConfig;
  conditionLogic: "ALL" | "ANY";
  isActive: boolean;
  conditions: { field: ConditionField; operator: ConditionOperator; value: string }[];
  actions: { type: ActionType; config: Record<string, unknown> }[];
}): BuilderValues {
  return {
    name: a.name,
    description: a.description ?? "",
    trigger: a.trigger,
    triggerConfig: a.triggerConfig ?? {},
    conditionLogic: a.conditionLogic,
    isActive: a.isActive,
    conditions: a.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
    actions: a.actions.map((x) => ({ type: x.type, config: { ...x.config } })),
  };
}

export interface TemplateLike {
  key: string;
  name: string;
  description: string;
  trigger: Trigger;
  triggerConfig?: TriggerConfig;
  conditions: readonly { field: ConditionField; operator: ConditionOperator; value: string }[];
  actions: readonly { type: ActionType; config?: Record<string, unknown>; needs?: string }[];
}

/**
 * Builder values for a template. `needs` placeholders are filled from the user's own data:
 * "transportation" → their Transportation category, "goal" → their only active goal (otherwise
 * left for them to choose).
 */
export function valuesFromTemplate(
  t: TemplateLike,
  data: { categories: { id: string; systemKey: string | null }[]; goals: { id: string; status: string }[] },
): BuilderValues {
  const activeGoals = data.goals.filter((g) => g.status === "ACTIVE");
  return {
    name: t.name,
    description: t.description,
    trigger: t.trigger,
    triggerConfig: { ...(t.triggerConfig ?? {}) },
    conditionLogic: "ALL",
    isActive: true,
    conditions: t.conditions.map((c) => ({ ...c })),
    actions: t.actions.map((a) => {
      const config: Record<string, unknown> = { ...(a.config ?? {}) };
      if (a.needs === "transportation") {
        const cat = data.categories.find((c) => c.systemKey === "transportation");
        if (cat) config.categoryId = cat.id;
      }
      if (a.needs === "goal" && activeGoals.length === 1) config.goalId = activeGoals[0].id;
      if (a.type === "ALLOCATE_TO_GOAL" && SCHEDULE_TRIGGERS.includes(t.trigger) && !config.amountCents) config.amountCents = 5000;
      return { type: a.type, config };
    }),
  };
}
