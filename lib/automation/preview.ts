/**
 * Pure helpers for the automation dry run ("preview on the last 90 days"). They mirror
 * what lib/automation/engine would do, without writing anything. Client-safe.
 */
import { addDays, daysInMonth, dayOfWeek, type LocalDate } from "@/lib/dates";
import { allocationAmount, roundUpAmount } from "./conditions";
import { actionConfigSchemas, type ActionType, type Trigger, type TriggerConfig } from "./schemas";

export interface PreviewTransaction {
  amountCents: number;
  categoryId: string | null;
  merchantName: string | null;
  description: string;
  isTransfer: boolean;
}

export interface EffectContext {
  categoryName: (id: string) => string | undefined;
  goalName: (id: string) => string | undefined;
  money: (cents: number) => string;
  /** True for categories of kind TRANSFER (setting one marks the transaction as a transfer). */
  isTransferCategory?: (id: string) => boolean;
}

export interface ActionEffect {
  type: ActionType;
  text: string;
  /** Amount of a planned goal allocation (never money moved). */
  plannedCents: number;
}

/** What one action would do to one transaction, or null when it would change nothing. */
export function actionEffect(txn: PreviewTransaction, action: { type: ActionType; config: Record<string, unknown> }, ctx: EffectContext): ActionEffect | null {
  const parsed = actionConfigSchemas[action.type].safeParse(action.config);
  if (!parsed.success) return null;
  const goalName = (id: string) => ctx.goalName(id) ?? "a goal";
  switch (action.type) {
    case "SET_CATEGORY": {
      const cfg = parsed.data as { categoryId: string };
      if (cfg.categoryId === txn.categoryId) return null;
      return { type: action.type, text: `Category → ${ctx.categoryName(cfg.categoryId) ?? "chosen category"}`, plannedCents: 0 };
    }
    case "ADD_TAG":
      return { type: action.type, text: `Tag “${(parsed.data as { tagName: string }).tagName}”`, plannedCents: 0 };
    case "MARK_TRANSFER":
      return txn.isTransfer ? null : { type: action.type, text: "Marked as a transfer", plannedCents: 0 };
    case "MARK_RECURRING":
      return { type: action.type, text: "Marked as recurring", plannedCents: 0 };
    case "SET_NOTE":
      return { type: action.type, text: "Note added", plannedCents: 0 };
    case "RENAME_MERCHANT": {
      const name = (parsed.data as { merchantName: string }).merchantName;
      return name === txn.merchantName ? null : { type: action.type, text: `Merchant → ${name}`, plannedCents: 0 };
    }
    case "ALLOCATE_TO_GOAL": {
      const cfg = parsed.data as { goalId: string; percentBps?: number; amountCents?: number; aboveCents?: number };
      if (txn.amountCents <= 0) return null;
      const planned = allocationAmount(txn.amountCents, cfg);
      if (planned <= 0) return null;
      return { type: action.type, text: `Plan ${ctx.money(planned)} for ${goalName(cfg.goalId)}`, plannedCents: planned };
    }
    case "ROUND_UP_TO_GOAL": {
      const cfg = parsed.data as { goalId: string; roundToCents: number };
      if (txn.isTransfer) return null;
      const up = roundUpAmount(txn.amountCents, cfg.roundToCents);
      if (up <= 0) return null;
      return { type: action.type, text: `Round-up of ${ctx.money(up)} planned for ${goalName(cfg.goalId)}`, plannedCents: up };
    }
    case "NOTIFY":
      return { type: action.type, text: "Notification", plannedCents: 0 };
  }
}

export function transactionEffects(txn: PreviewTransaction, actions: { type: ActionType; config: Record<string, unknown> }[], ctx: EffectContext): ActionEffect[] {
  const out: ActionEffect[] = [];
  let current = txn;
  for (const action of actions) {
    const effect = actionEffect(current, action, ctx);
    if (!effect) continue;
    out.push(effect);
    // The engine applies actions in order, so a category change is visible to later actions.
    if (action.type === "SET_CATEGORY") {
      const categoryId = (action.config as { categoryId: string }).categoryId;
      current = { ...current, categoryId, isTransfer: current.isTransfer || Boolean(ctx.isTransferCategory?.(categoryId)) };
    }
    if (action.type === "MARK_TRANSFER") current = { ...current, isTransfer: true };
  }
  return out;
}

/**
 * Dates in [from, to] on which a scheduled automation would have run. Monthly days past
 * the end of a short month run on its last day, like the engine.
 */
export function scheduledRunDates(trigger: Trigger, config: TriggerConfig, from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  if (trigger === "SCHEDULE_MONTHLY" && config.dayOfMonth) {
    let y = Number(from.slice(0, 4));
    let m = Number(from.slice(5, 7));
    for (let i = 0; i < 400; i++) {
      const day = Math.min(config.dayOfMonth, daysInMonth(y, m));
      const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (date > to) break;
      if (date >= from) out.push(date);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else if (trigger === "SCHEDULE_WEEKLY" && config.dayOfWeek !== undefined) {
    let d = from;
    while (dayOfWeek(d) !== config.dayOfWeek) d = addDays(d, 1);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
  }
  return out;
}

/** Fixed amount a scheduled run would plan (scheduled allocations are always fixed amounts). */
export function scheduledPlannedPerRun(actions: { type: ActionType; config: Record<string, unknown> }[]): number {
  let total = 0;
  for (const a of actions) {
    if (a.type !== "ALLOCATE_TO_GOAL") continue;
    const parsed = actionConfigSchemas.ALLOCATE_TO_GOAL.safeParse(a.config);
    if (parsed.success && parsed.data.amountCents) total += parsed.data.amountCents;
  }
  return total;
}
