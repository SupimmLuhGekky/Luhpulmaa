import "server-only";
import type { Automation, AutomationAction, AutomationCondition, CategoryKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isEnabled } from "@/lib/flags";
import { fromDbDate, startOfWeek, type LocalDate } from "@/lib/dates";
import { formatCurrency, toCents } from "@/lib/finance/money";
import { addContribution } from "@/lib/goals/service";
import { notify } from "@/lib/notifications/service";
import { allocationAmount, evaluateConditions, roundUpAmount, type Condition } from "./conditions";
import { actionConfigSchemas } from "./schemas";

/**
 * Automation engine.
 *
 * Every run of an automation for an event is recorded in AutomationRun with a unique
 * (automationId, idempotencyKey) — "txn:<id>", "month:2026-10", "week:2026-09-27",
 * "sub:<id>" — so re-running a sync or a scheduled job can never apply an action twice.
 *
 * Goal actions create PLANNED_ALLOCATION contributions: bookkeeping instructions,
 * not money movement. Nothing here moves money.
 */
type FullAutomation = Automation & { conditions: AutomationCondition[]; actions: AutomationAction[] };

async function loadAutomations(userId: string, triggers: Automation["trigger"][]): Promise<FullAutomation[]> {
  if (!isEnabled("ENABLE_AUTOMATIONS")) return [];
  return prisma.automation.findMany({
    where: { userId, isActive: true, trigger: { in: triggers } },
    include: { conditions: { orderBy: { sortOrder: "asc" } }, actions: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Claims the (automation, event) pair: returns the new run's id, or null when it already ran.
 * `INSERT … ON CONFLICT DO NOTHING` (skipDuplicates), so jobs that run several times a day
 * don't raise — and log — a unique-constraint error for every run that already happened.
 */
async function claimRun(userId: string, automationId: string, idempotencyKey: string, transactionId?: string): Promise<string | null> {
  const [run] = await prisma.automationRun.createManyAndReturn({
    data: [{ userId, automationId, idempotencyKey, transactionId: transactionId ?? null, status: "SKIPPED" }],
    select: { id: true },
    skipDuplicates: true,
  });
  return run?.id ?? null;
}

async function finishRun(runId: string, automationId: string, status: "SUCCESS" | "FAILED" | "SKIPPED", summary: string) {
  await prisma.automationRun.update({ where: { id: runId }, data: { status, summary: summary.slice(0, 500) } });
  if (status === "SUCCESS") {
    await prisma.automation.update({ where: { id: automationId }, data: { lastExecutedAt: new Date(), executionCount: { increment: 1 } } });
  }
}

/** Goal name for run summaries ("planned $50 for Car Fund"). */
async function goalLabel(userId: string, goalId: string): Promise<string> {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId }, select: { name: true } });
  return goal?.name ?? "a goal";
}

/**
 * Type and transfer flag that follow from a category, exactly as when the person changes the
 * category by hand: a transfer category makes it a transfer; any other category takes it out
 * of transfers (so a payment the keywords filed as a transfer counts as spending again).
 */
function kindForCategory(kind: CategoryKind, amountCents: number): { isTransfer: boolean; type: TxnForAutomation["type"] } {
  if (kind === "TRANSFER") return { isTransfer: true, type: "TRANSFER" };
  if (kind === "INCOME") return { isTransfer: false, type: amountCents > 0 ? "INCOME" : "EXPENSE" };
  return { isTransfer: false, type: amountCents > 0 ? "REFUND" : "EXPENSE" };
}

type TxnForAutomation = Prisma.TransactionGetPayload<{ select: { id: true; userId: true; accountId: true; merchantName: true; description: true; amountCents: true; categoryId: true; type: true; date: true; isTransfer: true } }>;

async function applyTransactionAction(userId: string, automation: FullAutomation, action: AutomationAction, txn: TxnForAutomation): Promise<string | null> {
  const amount = toCents(txn.amountCents);
  const date = fromDbDate(txn.date);
  switch (action.type) {
    case "SET_CATEGORY": {
      const cfg = actionConfigSchemas.SET_CATEGORY.parse(action.config);
      const cat = await prisma.category.findFirst({ where: { id: cfg.categoryId, userId }, include: { subcategories: { select: { id: true } } } });
      if (!cat) return null;
      const subOk = cfg.subcategoryId && cat.subcategories.some((s) => s.id === cfg.subcategoryId);
      const kind = kindForCategory(cat.kind, amount);
      await prisma.transaction.update({
        where: { id: txn.id },
        data: {
          categoryId: cat.id,
          subcategoryId: subOk ? cfg.subcategoryId : null,
          categorizedBy: "AUTOMATION",
          categorizedByRuleId: automation.id,
          categorizedByLabel: `Automation: ${automation.name}`,
          ...kind,
        },
      });
      txn.categoryId = cat.id;
      txn.isTransfer = kind.isTransfer;
      txn.type = kind.type;
      return `category → ${cat.name}`;
    }
    case "ADD_TAG": {
      const cfg = actionConfigSchemas.ADD_TAG.parse(action.config);
      const tag = await prisma.tag.upsert({ where: { userId_name: { userId, name: cfg.tagName } }, update: {}, create: { userId, name: cfg.tagName } });
      await prisma.transactionTag.upsert({ where: { transactionId_tagId: { transactionId: txn.id, tagId: tag.id } }, update: {}, create: { transactionId: txn.id, tagId: tag.id } });
      return `tag “${cfg.tagName}”`;
    }
    case "MARK_TRANSFER":
      await prisma.transaction.update({ where: { id: txn.id }, data: { isTransfer: true, type: "TRANSFER" } });
      // Later actions and automations in the same run (e.g. a round-up) must see it as a transfer too.
      txn.isTransfer = true;
      txn.type = "TRANSFER";
      return "marked as transfer";
    case "MARK_RECURRING":
      await prisma.transaction.update({ where: { id: txn.id }, data: { isRecurring: true } });
      return "marked as recurring";
    case "SET_NOTE": {
      const cfg = actionConfigSchemas.SET_NOTE.parse(action.config);
      await prisma.transaction.update({ where: { id: txn.id }, data: { notes: cfg.note } });
      return "note added";
    }
    case "RENAME_MERCHANT": {
      const cfg = actionConfigSchemas.RENAME_MERCHANT.parse(action.config);
      await prisma.transaction.update({ where: { id: txn.id }, data: { merchantName: cfg.merchantName } });
      return `merchant → ${cfg.merchantName}`;
    }
    case "ALLOCATE_TO_GOAL": {
      const cfg = actionConfigSchemas.ALLOCATE_TO_GOAL.parse(action.config);
      if (amount <= 0) return null;
      const alloc = allocationAmount(amount, cfg);
      if (alloc <= 0) return null;
      const c = await addContribution(userId, cfg.goalId, {
        amountCents: alloc,
        date,
        kind: "PLANNED_ALLOCATION",
        source: "AUTOMATION",
        automationId: automation.id,
        transactionId: txn.id,
        note: `Planned from ${txn.merchantName || txn.description}`,
        idempotencyKey: `automation:${automation.id}:txn:${txn.id}:${action.id}`,
      }).catch(() => null);
      return c ? `planned ${formatCurrency(alloc)} for ${await goalLabel(userId, cfg.goalId)}` : null;
    }
    case "ROUND_UP_TO_GOAL": {
      const cfg = actionConfigSchemas.ROUND_UP_TO_GOAL.parse(action.config);
      if (txn.isTransfer) return null;
      const up = roundUpAmount(amount, cfg.roundToCents);
      if (up <= 0) return null;
      const c = await addContribution(userId, cfg.goalId, {
        amountCents: up,
        date,
        kind: "PLANNED_ALLOCATION",
        source: "ROUND_UP",
        automationId: automation.id,
        transactionId: txn.id,
        note: `Round-up of ${txn.merchantName || txn.description}`,
        idempotencyKey: `automation:${automation.id}:txn:${txn.id}:${action.id}`,
      }).catch(() => null);
      return c ? `round-up of ${formatCurrency(up)} planned for ${await goalLabel(userId, cfg.goalId)}` : null;
    }
    case "NOTIFY": {
      const cfg = actionConfigSchemas.NOTIFY.parse(action.config);
      await notify(userId, {
        type: "AUTOMATION",
        title: cfg.title,
        body: cfg.message || `${txn.merchantName || txn.description}: ${formatCurrency(amount, { signed: true })} on ${date}.`,
        href: `/transactions?id=${txn.id}`,
        dedupeKey: `automation:${automation.id}:txn:${txn.id}`,
      });
      return "notified";
    }
  }
}

/**
 * Runs TRANSACTION_CREATED (and INCOME_RECEIVED for income) automations on newly
 * imported/created transactions. Safe to call repeatedly with the same ids.
 */
export async function runTransactionAutomations(userId: string, transactionIds: string[], opts: { onlyAutomationId?: string } = {}) {
  if (!transactionIds.length) return { executed: 0 };
  // `onlyAutomationId` limits a run to one automation ("apply this one to recent transactions").
  const automations = (await loadAutomations(userId, ["TRANSACTION_CREATED", "INCOME_RECEIVED"])).filter((a) => !opts.onlyAutomationId || a.id === opts.onlyAutomationId);
  if (!automations.length) return { executed: 0 };
  const txns = await prisma.transaction.findMany({
    where: { userId, id: { in: transactionIds } },
    select: { id: true, userId: true, accountId: true, merchantName: true, description: true, amountCents: true, categoryId: true, type: true, date: true, isTransfer: true },
    orderBy: { date: "asc" },
  });
  let executed = 0;
  for (const txn of txns) {
    for (const automation of automations) {
      if (automation.trigger === "INCOME_RECEIVED" && (txn.type !== "INCOME" || toCents(txn.amountCents) <= 0)) continue;
      const conditions = automation.conditions as unknown as Condition[];
      const evaluable = { ...txn, amountCents: toCents(txn.amountCents) };
      if (!evaluateConditions(evaluable, conditions, automation.conditionLogic)) continue;
      const runId = await claimRun(userId, automation.id, `txn:${txn.id}`, txn.id);
      if (!runId) continue;
      const done: string[] = [];
      try {
        for (const action of automation.actions) {
          const r = await applyTransactionAction(userId, automation, action, txn);
          if (r) done.push(r);
        }
        await finishRun(runId, automation.id, done.length ? "SUCCESS" : "SKIPPED", done.join("; ") || "No action applied");
        if (done.length) executed++;
      } catch (error) {
        await finishRun(runId, automation.id, "FAILED", "An action could not be completed.");
        console.error("[automation] action failed", automation.id, error instanceof Error ? error.message : "unknown");
      }
    }
  }
  return { executed };
}

/** Runs SCHEDULE_MONTHLY / SCHEDULE_WEEKLY automations due on `today`. */
export async function runScheduledAutomations(userId: string, today: LocalDate) {
  const automations = await loadAutomations(userId, ["SCHEDULE_MONTHLY", "SCHEDULE_WEEKLY"]);
  const day = Number(today.slice(8, 10));
  const lastDay = Number(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate());
  let executed = 0;
  for (const a of automations) {
    const cfg = a.triggerConfig as { dayOfMonth?: number; dayOfWeek?: number };
    let key: string | null = null;
    if (a.trigger === "SCHEDULE_MONTHLY" && cfg.dayOfMonth && day >= Math.min(cfg.dayOfMonth, lastDay)) key = `month:${today.slice(0, 7)}`;
    if (a.trigger === "SCHEDULE_WEEKLY" && cfg.dayOfWeek !== undefined) {
      const weekStart = startOfWeek(today, cfg.dayOfWeek);
      key = `week:${weekStart}`;
    }
    if (!key) continue;
    const runId = await claimRun(userId, a.id, key);
    if (!runId) continue;
    const done: string[] = [];
    try {
      for (const action of a.actions) {
        if (action.type === "ALLOCATE_TO_GOAL") {
          const c = actionConfigSchemas.ALLOCATE_TO_GOAL.parse(action.config);
          if (!c.amountCents) continue;
          const r = await addContribution(userId, c.goalId, {
            amountCents: c.amountCents,
            date: today,
            kind: "PLANNED_ALLOCATION",
            source: "AUTOMATION",
            automationId: a.id,
            note: `Scheduled: ${a.name}`,
            idempotencyKey: `automation:${a.id}:${key}:${action.id}`,
          }).catch(() => null);
          if (r) done.push(`planned ${formatCurrency(c.amountCents)} for ${await goalLabel(userId, c.goalId)}`);
        } else if (action.type === "NOTIFY") {
          const c = actionConfigSchemas.NOTIFY.parse(action.config);
          await notify(userId, { type: "AUTOMATION", title: c.title, body: c.message ?? a.name, dedupeKey: `automation:${a.id}:${key}` });
          done.push("notified");
        }
      }
      await finishRun(runId, a.id, done.length ? "SUCCESS" : "SKIPPED", done.join("; ") || "No action applied");
      if (done.length) executed++;
    } catch (error) {
      await finishRun(runId, a.id, "FAILED", "An action could not be completed.");
      console.error("[automation] scheduled failed", a.id, error instanceof Error ? error.message : "unknown");
    }
  }
  return { executed };
}

/** Fires SUBSCRIPTION_DETECTED automations (NOTIFY actions) for a newly detected subscription. */
export async function runSubscriptionDetectedAutomations(userId: string, subscription: { id: string; name: string; amountCents: number }) {
  const automations = await loadAutomations(userId, ["SUBSCRIPTION_DETECTED"]);
  for (const a of automations) {
    const runId = await claimRun(userId, a.id, `sub:${subscription.id}`);
    if (!runId) continue;
    for (const action of a.actions) {
      if (action.type !== "NOTIFY") continue;
      const c = actionConfigSchemas.NOTIFY.parse(action.config);
      await notify(userId, {
        type: "SUBSCRIPTION",
        title: c.title,
        body: c.message || `New subscription detected: ${subscription.name} (${formatCurrency(subscription.amountCents)}).`,
        href: "/subscriptions",
        dedupeKey: `automation:${a.id}:sub:${subscription.id}`,
      });
    }
    await finishRun(runId, a.id, "SUCCESS", "notified");
  }
}

/** Fires BUDGET_THRESHOLD automations for a budget line crossing `usedPercent`. */
export async function runBudgetThresholdAutomations(userId: string, event: { budgetItemId: string; categoryId: string | null; categoryName: string; usedPercent: number; periodKey: string; spent: number; available: number }) {
  const automations = await loadAutomations(userId, ["BUDGET_THRESHOLD"]);
  for (const a of automations) {
    const cfg = a.triggerConfig as { thresholdPercent?: number; categoryId?: string };
    if (!cfg.thresholdPercent || event.usedPercent < cfg.thresholdPercent) continue;
    if (cfg.categoryId && cfg.categoryId !== event.categoryId) continue;
    const runId = await claimRun(userId, a.id, `budget:${event.periodKey}:${event.budgetItemId}:${cfg.thresholdPercent}`);
    if (!runId) continue;
    for (const action of a.actions) {
      if (action.type !== "NOTIFY") continue;
      const c = actionConfigSchemas.NOTIFY.parse(action.config);
      await notify(userId, {
        type: "BUDGET_WARNING",
        severity: event.usedPercent >= 100 ? "WARNING" : "INFO",
        title: c.title,
        body: c.message || `${event.categoryName} budget is ${event.usedPercent}% used (${formatCurrency(event.spent)} of ${formatCurrency(event.available)}).`,
        href: "/budget",
        dedupeKey: `automation:${a.id}:budget:${event.periodKey}:${event.budgetItemId}`,
      });
    }
    await finishRun(runId, a.id, "SUCCESS", "notified");
  }
}
