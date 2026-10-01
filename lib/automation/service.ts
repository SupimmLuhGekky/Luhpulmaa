import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { addDays, fromDbDate, monthKey, todayIn, toDbDate } from "@/lib/dates";
import { formatCurrency, toCents } from "@/lib/finance/money";
import { budgetView, findBudget } from "@/lib/budget/service";
import { evaluateConditions, type Condition } from "./conditions";
import { scheduledPlannedPerRun, scheduledRunDates, transactionEffects } from "./preview";
import {
  ACTION_TRIGGERS,
  actionTypeSchema,
  automationInputSchema,
  conditionInputSchema,
  conditionProblem,
  isTransactionTrigger,
  triggerConfigSchema,
  triggerSchema,
  type AutomationFormInput,
  type AutomationInput,
} from "./schemas";
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

export async function createAutomation(userId: string, raw: AutomationFormInput) {
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

export async function updateAutomation(userId: string, id: string, raw: AutomationFormInput) {
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

export async function listRuns(userId: string, opts: { automationId?: string; take?: number; cursor?: string } = {}) {
  const take = Math.min(opts.take ?? 30, 100);
  const runs = await prisma.automationRun.findMany({
    where: { userId, ...(opts.automationId ? { automationId: opts.automationId } : {}), status: { not: "SKIPPED" } },
    orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { automation: { select: { id: true, name: true } }, transaction: { select: { id: true, merchantName: true, description: true, amountCents: true, date: true } } },
  });
  const hasMore = runs.length > take;
  const items = runs.slice(0, take).map((r) => ({
    id: r.id,
    status: r.status,
    summary: r.summary,
    executedAt: r.executedAt.toISOString(),
    /** "txn:…", "month:2026-10", "week:…", "sub:…", "budget:…" — the event that triggered the run. */
    event: r.idempotencyKey.split(":")[0] ?? "event",
    automation: r.automation,
    transaction: r.transaction
      ? { id: r.transaction.id, label: r.transaction.merchantName ?? r.transaction.description, amountCents: toCents(r.transaction.amountCents), date: fromDbDate(r.transaction.date) }
      : null,
  }));
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export type AutomationRunDTO = Awaited<ReturnType<typeof listRuns>>["items"][number];

export const PREVIEW_DAYS = 90;

export const previewInputSchema = z.object({
  trigger: triggerSchema,
  triggerConfig: triggerConfigSchema.default({}),
  conditionLogic: z.enum(["ALL", "ANY"]).default("ALL"),
  conditions: z.array(conditionInputSchema).max(10).default([]),
  /** Actions may still be incomplete while the user is building; invalid ones are ignored. */
  actions: z.array(z.object({ type: actionTypeSchema, config: z.record(z.unknown()).default({}) })).max(10).default([]),
});

export type PreviewInput = z.input<typeof previewInputSchema>;

export interface PreviewExample {
  id: string;
  label: string;
  date: string;
  amountCents: number;
  effects: string[];
}

export type AutomationPreview =
  | { kind: "transactions"; days: number; from: string; sampled: number; matched: number; affected: number; plannedCents: number; examples: PreviewExample[] }
  | { kind: "schedule"; days: number; from: string; runs: string[]; plannedPerRunCents: number; plannedCents: number; notifies: boolean }
  | { kind: "subscriptions"; days: number; from: string; detected: { name: string; amountCents: number; date: string }[] }
  | { kind: "budget"; month: string | null; lines: { name: string; usedPercent: number }[]; thresholdPercent: number | null };

/**
 * Dry run for the builder: what the automation would have done over the last 90 days.
 * Transactions are matched with the same condition logic as the engine and each action's
 * effect is computed, but nothing is written. Goal amounts are planned allocations only.
 */
export async function previewAutomation(userId: string, raw: PreviewInput, money: (cents: number) => string = (c) => formatCurrency(c)): Promise<AutomationPreview> {
  const input = previewInputSchema.parse(raw);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const today = todayIn(user.timeZone);
  const from = addDays(today, -(PREVIEW_DAYS - 1));
  const conditions = input.conditions.filter((c) => !conditionProblem(c)) as Condition[];

  if (isTransactionTrigger(input.trigger)) {
    const [txns, categories, goals] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId, date: { gte: toDbDate(from) }, ...(input.trigger === "INCOME_RECEIVED" ? { type: "INCOME", amountCents: { gt: 0 } } : {}) },
        select: { id: true, merchantName: true, description: true, amountCents: true, categoryId: true, accountId: true, type: true, date: true, isTransfer: true },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 2000,
      }),
      prisma.category.findMany({ where: { userId }, select: { id: true, name: true, kind: true } }),
      prisma.goal.findMany({ where: { userId }, select: { id: true, name: true } }),
    ]);
    const catById = new Map(categories.map((c) => [c.id, c]));
    const goalById = new Map(goals.map((g) => [g.id, g.name]));
    const ctx = { categoryName: (id: string) => catById.get(id)?.name, goalName: (id: string) => goalById.get(id), money, isTransferCategory: (id: string) => catById.get(id)?.kind === "TRANSFER" };
    const actions = input.actions.filter((a) => ACTION_TRIGGERS[a.type].includes(input.trigger));
    let matched = 0;
    let affected = 0;
    let plannedCents = 0;
    const examples: PreviewExample[] = [];
    for (const t of txns) {
      const amountCents = toCents(t.amountCents);
      if (!evaluateConditions({ ...t, amountCents }, conditions, input.conditionLogic)) continue;
      matched++;
      const effects = transactionEffects({ amountCents, categoryId: t.categoryId, merchantName: t.merchantName, description: t.description, isTransfer: t.isTransfer }, actions, ctx);
      if (effects.length) affected++;
      plannedCents += effects.reduce((sum, e) => sum + e.plannedCents, 0);
      if (examples.length < 8) examples.push({ id: t.id, label: t.merchantName ?? t.description, date: fromDbDate(t.date), amountCents, effects: effects.map((e) => e.text) });
    }
    return { kind: "transactions", days: PREVIEW_DAYS, from, sampled: txns.length, matched, affected, plannedCents, examples };
  }

  if (input.trigger === "SCHEDULE_MONTHLY" || input.trigger === "SCHEDULE_WEEKLY") {
    const runs = scheduledRunDates(input.trigger, input.triggerConfig, from, today);
    const perRun = scheduledPlannedPerRun(input.actions);
    return { kind: "schedule", days: PREVIEW_DAYS, from, runs, plannedPerRunCents: perRun, plannedCents: perRun * runs.length, notifies: input.actions.some((a) => a.type === "NOTIFY") };
  }

  if (input.trigger === "SUBSCRIPTION_DETECTED") {
    const subs = await prisma.subscription.findMany({
      where: { userId, isDetected: true, createdAt: { gte: toDbDate(from) } },
      select: { name: true, amountCents: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { kind: "subscriptions", days: PREVIEW_DAYS, from, detected: subs.map((s) => ({ name: s.name, amountCents: toCents(s.amountCents), date: todayIn(user.timeZone, s.createdAt) })) };
  }

  // BUDGET_THRESHOLD: show which of this month's budget lines are already past the threshold.
  const threshold = input.triggerConfig.thresholdPercent ?? null;
  const budget = await findBudget(userId, "MONTHLY", `${monthKey(today)}-01`);
  if (!budget || !threshold) return { kind: "budget", month: budget ? monthKey(today) : null, lines: [], thresholdPercent: threshold };
  const view = await budgetView(userId, budget.id);
  const lines = view.lines
    .filter((l) => (!input.triggerConfig.categoryId || l.categoryId === input.triggerConfig.categoryId) && l.available > 0 && Math.floor(l.usedBps / 100) >= threshold)
    .map((l) => ({ name: l.name, usedPercent: Math.floor(l.usedBps / 100) }));
  return { kind: "budget", month: monthKey(today), lines, thresholdPercent: threshold };
}

/**
 * Applies a transaction automation to matching transactions from the last N days
 * (opt-in "run on existing transactions"). Idempotent through run keys, so
 * transactions it already handled are never touched twice.
 */
export async function applyToRecent(userId: string, id: string, days = 30) {
  const a = await prisma.automation.findFirst({ where: { id, userId }, select: { trigger: true, isActive: true } });
  if (!a) throw notFound("Automation");
  if (!isTransactionTrigger(a.trigger)) throw new AppError("BAD_REQUEST", "Only transaction automations can be applied to past transactions.");
  if (!a.isActive) throw new AppError("BAD_REQUEST", "Turn the automation on first.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const since = addDays(todayIn(user.timeZone), -Math.min(Math.max(days, 1), 365));
  const ids = (await prisma.transaction.findMany({ where: { userId, date: { gte: toDbDate(since) } }, select: { id: true } })).map((t) => t.id);
  const { executed } = await runTransactionAutomations(userId, ids, { onlyAutomationId: id });
  await audit(userId, "automation.updated", { type: "automation", id }, { appliedToRecentDays: days, applied: executed });
  return { applied: executed, scanned: ids.length };
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
