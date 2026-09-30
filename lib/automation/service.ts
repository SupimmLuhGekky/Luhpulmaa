import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { addDays, fromDbDate, todayIn, toDbDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { evaluateConditions, type Condition } from "./conditions";
import { automationInputSchema, type AutomationInput } from "./schemas";
import { runTransactionAutomations } from "./engine";

const include = {
  conditions: { orderBy: { sortOrder: "asc" } },
  actions: { orderBy: { sortOrder: "asc" } },
  _count: { select: { runs: true } },
} as const satisfies Prisma.AutomationInclude;

export type AutomationWithParts = Prisma.AutomationGetPayload<{ include: typeof include }>;

export function toAutomationDTO(a: AutomationWithParts) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    trigger: a.trigger,
    triggerConfig: (a.triggerConfig ?? {}) as AutomationInput["triggerConfig"],
    conditionLogic: a.conditionLogic,
    isActive: a.isActive,
    lastExecutedAt: a.lastExecutedAt?.toISOString() ?? null,
    executionCount: a.executionCount,
    createdAt: a.createdAt.toISOString(),
    conditions: a.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
    actions: a.actions.map((x) => ({ type: x.type, config: (x.config ?? {}) as Record<string, unknown> })),
    runCount: a._count.runs,
  };
}

export type AutomationDTO = ReturnType<typeof toAutomationDTO>;

export async function listAutomations(userId: string) {
  const rows = await prisma.automation.findMany({ where: { userId }, include, orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
  return rows.map(toAutomationDTO);
}

export async function getAutomation(userId: string, id: string) {
  const a = await prisma.automation.findFirst({ where: { id, userId }, include });
  if (!a) throw notFound("Automation");
  return toAutomationDTO(a);
}

/** Every id referenced by conditions/actions/trigger must belong to the user. */
async function assertReferences(userId: string, input: AutomationInput) {
  const categoryIds = new Set<string>();
  const accountIds = new Set<string>();
  const goalIds = new Set<string>();
  if (input.triggerConfig.categoryId) categoryIds.add(input.triggerConfig.categoryId);
  for (const c of input.conditions) {
    if (c.field === "CATEGORY") categoryIds.add(c.value);
    if (c.field === "ACCOUNT") accountIds.add(c.value);
    if (c.field === "AMOUNT" && !/^\d+$/.test(c.value)) throw new AppError("VALIDATION_FAILED", "Amount conditions need a whole number of cents.");
  }
  for (const a of input.actions) {
    const cfg = a.config as { categoryId?: string; goalId?: string };
    if (a.type === "SET_CATEGORY" && cfg.categoryId) categoryIds.add(cfg.categoryId);
    if ((a.type === "ALLOCATE_TO_GOAL" || a.type === "ROUND_UP_TO_GOAL") && cfg.goalId) goalIds.add(cfg.goalId);
  }
  const [cats, accts, goals] = await Promise.all([
    categoryIds.size ? prisma.category.count({ where: { userId, id: { in: [...categoryIds] } } }) : 0,
    accountIds.size ? prisma.account.count({ where: { userId, id: { in: [...accountIds] } } }) : 0,
    goalIds.size ? prisma.goal.count({ where: { userId, id: { in: [...goalIds] } } }) : 0,
  ]);
  if (cats !== categoryIds.size) throw notFound("Category");
  if (accts !== accountIds.size) throw notFound("Account");
  if (goals !== goalIds.size) throw notFound("Goal");
}

function partsData(input: AutomationInput) {
  return {
    conditions: { create: input.conditions.map((c, i) => ({ field: c.field, operator: c.operator, value: c.value, sortOrder: i })) },
    actions: { create: input.actions.map((a, i) => ({ type: a.type, config: a.config as Prisma.InputJsonValue, sortOrder: i })) },
  };
}

export async function createAutomation(userId: string, raw: AutomationInput) {
  const input = automationInputSchema.parse(raw);
  await assertReferences(userId, input);
  const count = await prisma.automation.count({ where: { userId } });
  if (count >= 100) throw new AppError("CONFLICT", "You can have up to 100 automations.");
  const created = await prisma.automation.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      trigger: input.trigger,
      triggerConfig: input.triggerConfig as Prisma.InputJsonValue,
      conditionLogic: input.conditionLogic,
      isActive: input.isActive,
      ...partsData(input),
    },
    include,
  });
  await audit(userId, "automation.created", { type: "automation", id: created.id }, { trigger: input.trigger, actions: input.actions.map((a) => a.type) });
  return toAutomationDTO(created);
}

export async function updateAutomation(userId: string, id: string, raw: AutomationInput) {
  const input = automationInputSchema.parse(raw);
  const existing = await prisma.automation.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw notFound("Automation");
  await assertReferences(userId, input);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.automationCondition.deleteMany({ where: { automationId: id } });
    await tx.automationAction.deleteMany({ where: { automationId: id } });
    return tx.automation.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description ?? null,
        trigger: input.trigger,
        triggerConfig: input.triggerConfig as Prisma.InputJsonValue,
        conditionLogic: input.conditionLogic,
        isActive: input.isActive,
        ...partsData(input),
      },
      include,
    });
  });
  await audit(userId, "automation.updated", { type: "automation", id }, { trigger: input.trigger });
  return toAutomationDTO(updated);
}

export async function setAutomationActive(userId: string, id: string, isActive: boolean) {
  const { count } = await prisma.automation.updateMany({ where: { id, userId }, data: { isActive } });
  if (!count) throw notFound("Automation");
  await audit(userId, "automation.updated", { type: "automation", id }, { isActive });
}

export async function deleteAutomation(userId: string, id: string) {
  const { count } = await prisma.automation.deleteMany({ where: { id, userId } });
  if (!count) throw notFound("Automation");
  await audit(userId, "automation.deleted", { type: "automation", id });
}

export async function listRuns(userId: string, opts: { automationId?: string; take?: number } = {}) {
  const runs = await prisma.automationRun.findMany({
    where: { userId, ...(opts.automationId ? { automationId: opts.automationId } : {}), status: { not: "SKIPPED" } },
    orderBy: { executedAt: "desc" },
    take: Math.min(opts.take ?? 30, 100),
    include: { automation: { select: { id: true, name: true } }, transaction: { select: { id: true, merchantName: true, description: true, amountCents: true } } },
  });
  return runs.map((r) => ({
    id: r.id,
    status: r.status,
    summary: r.summary,
    executedAt: r.executedAt.toISOString(),
    automation: r.automation,
    transaction: r.transaction ? { id: r.transaction.id, label: r.transaction.merchantName ?? r.transaction.description, amountCents: toCents(r.transaction.amountCents) } : null,
  }));
}

/**
 * Dry run for the builder: which of the last 90 days' transactions would the
 * conditions match? Nothing is changed.
 */
export async function previewAutomation(userId: string, input: Pick<AutomationInput, "trigger" | "conditions" | "conditionLogic">) {
  if (input.trigger !== "TRANSACTION_CREATED" && input.trigger !== "INCOME_RECEIVED") return { matched: 0, sampled: 0, examples: [] };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const since = addDays(todayIn(user.timeZone), -90);
  const txns = await prisma.transaction.findMany({
    where: { userId, date: { gte: toDbDate(since) }, ...(input.trigger === "INCOME_RECEIVED" ? { type: "INCOME", amountCents: { gt: 0 } } : {}) },
    select: { id: true, merchantName: true, description: true, amountCents: true, categoryId: true, accountId: true, type: true, date: true },
    orderBy: { date: "desc" },
    take: 2000,
  });
  const matches = txns.filter((t) => evaluateConditions({ ...t, amountCents: toCents(t.amountCents) }, input.conditions as Condition[], input.conditionLogic));
  return {
    matched: matches.length,
    sampled: txns.length,
    examples: matches.slice(0, 5).map((t) => ({ id: t.id, label: t.merchantName ?? t.description, amountCents: toCents(t.amountCents), date: fromDbDate(t.date) })),
  };
}

/**
 * Applies a transaction automation to matching transactions from the last N days
 * (opt-in "run on existing transactions"). Idempotent through run keys.
 */
export async function applyToRecent(userId: string, id: string, days = 30) {
  const a = await prisma.automation.findFirst({ where: { id, userId }, select: { trigger: true, isActive: true } });
  if (!a) throw notFound("Automation");
  if (a.trigger !== "TRANSACTION_CREATED" && a.trigger !== "INCOME_RECEIVED") throw new AppError("BAD_REQUEST", "Only transaction automations can be applied to past transactions.");
  if (!a.isActive) throw new AppError("BAD_REQUEST", "Turn the automation on first.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const since = addDays(todayIn(user.timeZone), -Math.min(Math.max(days, 1), 365));
  const ids = (await prisma.transaction.findMany({ where: { userId, date: { gte: toDbDate(since) } }, select: { id: true } })).map((t) => t.id);
  return runTransactionAutomations(userId, ids);
}

/** Ready-made recipes shown in the builder (the user still reviews and saves them). */
export const AUTOMATION_TEMPLATES = [
  {
    key: "uber-transport",
    name: "Uber rides → Transportation",
    description: "Categorise rideshare trips automatically.",
    trigger: "TRANSACTION_CREATED",
    conditions: [{ field: "MERCHANT", operator: "EQUALS", value: "Uber" }],
    actions: [{ type: "SET_CATEGORY", needs: "transportation" }],
  },
  {
    key: "large-purchase",
    name: "Tag large purchases",
    description: "Add a “Large Purchase” tag to anything over $100.",
    trigger: "TRANSACTION_CREATED",
    conditions: [{ field: "AMOUNT", operator: "GREATER_THAN", value: "10000" }],
    actions: [{ type: "ADD_TAG", config: { tagName: "Large Purchase" } }],
  },
  {
    key: "payday-goal",
    name: "Payday: plan 20% for a goal",
    description: "Every paycheque, plan 20% toward a savings goal.",
    trigger: "INCOME_RECEIVED",
    conditions: [],
    actions: [{ type: "ALLOCATE_TO_GOAL", config: { percentBps: 2000 }, needs: "goal" }],
  },
  {
    key: "excess-income",
    name: "Big paycheque: 20% of the excess",
    description: "When income above $2,000 arrives, plan 20% of the excess for a goal.",
    trigger: "INCOME_RECEIVED",
    conditions: [{ field: "AMOUNT", operator: "GREATER_THAN", value: "200000" }],
    actions: [{ type: "ALLOCATE_TO_GOAL", config: { percentBps: 2000, aboveCents: 200000 }, needs: "goal" }],
  },
  {
    key: "monthly-emergency",
    name: "Monthly $300 for the emergency fund",
    description: "On the 1st of each month, plan $300 for a goal.",
    trigger: "SCHEDULE_MONTHLY",
    triggerConfig: { dayOfMonth: 1 },
    conditions: [],
    actions: [{ type: "ALLOCATE_TO_GOAL", config: { amountCents: 30000 }, needs: "goal" }],
  },
  {
    key: "round-ups",
    name: "Round up purchases",
    description: "Round purchases to the next dollar and plan the difference for a goal.",
    trigger: "TRANSACTION_CREATED",
    conditions: [{ field: "TYPE", operator: "EQUALS", value: "EXPENSE" }],
    actions: [{ type: "ROUND_UP_TO_GOAL", config: { roundToCents: 100 }, needs: "goal" }],
  },
  {
    key: "subscription-alert",
    name: "Tell me about new subscriptions",
    description: "Get notified when a new subscription is detected.",
    trigger: "SUBSCRIPTION_DETECTED",
    conditions: [],
    actions: [{ type: "NOTIFY", config: { title: "New subscription detected" } }],
  },
  {
    key: "budget-80",
    name: "Budget at 80%",
    description: "Notify me when any budget category is 80% spent.",
    trigger: "BUDGET_THRESHOLD",
    triggerConfig: { thresholdPercent: 80 },
    conditions: [],
    actions: [{ type: "NOTIFY", config: { title: "Budget almost used" } }],
  },
] as const;
