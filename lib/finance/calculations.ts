/**
 * Core deterministic financial calculations. Pure functions: no database, no clock.
 * Every function takes and returns integer cents (see ./money).
 */
import { addDays, daysBetween, type LocalDate } from "@/lib/dates";
import { BPS_100, mulDiv, ratioBps, sumCents, type Bps, type Cents } from "./money";

// ─────────────────────────────────────────────────────────────────────────────
// Budget
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetRemaining {
  /** Budgeted amount including any rollover carried in. */
  available: Cents;
  spent: Cents;
  remaining: Cents;
  /** Share of `available` used, in basis points (can exceed 10000). */
  usedBps: Bps;
  status: "on_track" | "warning" | "over";
}

/**
 * @param budgeted amount planned for the period
 * @param spent net spending in the period (expenses minus refunds), positive
 * @param rollover amount carried over from the previous period (may be 0)
 * @param warningBps threshold at which status becomes "warning" (default 80%)
 */
export function calculateBudgetRemaining(budgeted: Cents, spent: Cents, rollover: Cents = 0, warningBps: Bps = 8000): BudgetRemaining {
  const available = budgeted + rollover;
  const remaining = available - spent;
  const usedBps = available > 0 ? ratioBps(spent, available) : spent > 0 ? BPS_100 * 10 : 0;
  const status = remaining < 0 ? "over" : usedBps >= warningBps ? "warning" : "on_track";
  return { available, spent, remaining, usedBps, status };
}

/** Amount to carry into the next period when rollover is enabled. Overspending is not carried (floor at 0). */
export function calculateRollover(budgeted: Cents, spent: Cents, previousRollover: Cents = 0): Cents {
  return Math.max(0, budgeted + previousRollover - spent);
}

/** Resolves a budget line that may be a fixed amount or a percentage of income. */
export function resolveBudgetAmount(
  item: { amountType: "FIXED" | "PERCENT_OF_INCOME"; amountCents: Cents; percentBps: Bps | null },
  plannedIncome: Cents | null,
): Cents {
  if (item.amountType === "PERCENT_OF_INCOME") {
    if (!plannedIncome || item.percentBps === null) return 0;
    return mulDiv(plannedIncome, item.percentBps, BPS_100);
  }
  return item.amountCents;
}

export interface ZeroBasedSummary {
  income: Cents;
  allocated: Cents;
  unallocated: Cents;
  state: "fully_allocated" | "under_allocated" | "over_allocated";
}

export function calculateZeroBased(income: Cents, allocations: Cents[]): ZeroBasedSummary {
  const allocated = sumCents(allocations);
  const unallocated = income - allocated;
  return {
    income,
    allocated,
    unallocated,
    state: unallocated === 0 ? "fully_allocated" : unallocated > 0 ? "under_allocated" : "over_allocated",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Goals
// ─────────────────────────────────────────────────────────────────────────────

export interface GoalProgress {
  target: Cents;
  current: Cents;
  remaining: Cents;
  progressBps: Bps;
  isComplete: boolean;
  daysLeft: number | null;
  /** Contributions needed per period to reach the target by the deadline (null without deadline). */
  requiredWeekly: Cents | null;
  requiredBiweekly: Cents | null;
  requiredMonthly: Cents | null;
  isOverdue: boolean;
}

function ceilDiv(a: number, b: number): number {
  if (b <= 0) return a;
  return Math.ceil(a / b);
}

/**
 * Goal progress and required contributions. Required amounts are rounded UP to the
 * next cent so that following them always reaches the target.
 * Monthly requirement uses the average month length (365.25 / 12 days).
 */
export function calculateGoalProgress(
  target: Cents,
  current: Cents,
  deadline: LocalDate | null,
  today: LocalDate,
): GoalProgress {
  const remaining = Math.max(0, target - current);
  const progressBps = target > 0 ? Math.min(BPS_100, Math.max(0, ratioBps(current, target))) : 0;
  const isComplete = target > 0 && current >= target;
  if (!deadline) {
    return { target, current, remaining, progressBps, isComplete, daysLeft: null, requiredWeekly: null, requiredBiweekly: null, requiredMonthly: null, isOverdue: false };
  }
  const daysLeft = daysBetween(today, deadline);
  const isOverdue = daysLeft < 0 && !isComplete;
  if (isComplete) {
    return { target, current, remaining, progressBps, isComplete, daysLeft, requiredWeekly: 0, requiredBiweekly: 0, requiredMonthly: 0, isOverdue: false };
  }
  if (daysLeft <= 0) {
    return { target, current, remaining, progressBps, isComplete, daysLeft, requiredWeekly: remaining, requiredBiweekly: remaining, requiredMonthly: remaining, isOverdue };
  }
  // Number of whole periods left, at least 1 (you can always contribute once before the deadline).
  const weeks = Math.max(1, Math.floor(daysLeft / 7));
  const biweeks = Math.max(1, Math.floor(daysLeft / 14));
  // months = daysLeft / 30.4375 → use integer math: daysLeft * 400 / 12175
  const monthsTimes1000 = Math.floor((daysLeft * 400_000) / 12_175);
  const requiredMonthly = monthsTimes1000 >= 1000 ? Math.ceil((remaining * 1000) / monthsTimes1000) : remaining;
  return {
    target,
    current,
    remaining,
    progressBps,
    isComplete,
    daysLeft,
    requiredWeekly: ceilDiv(remaining, weeks),
    requiredBiweekly: ceilDiv(remaining, biweeks),
    requiredMonthly,
    isOverdue,
  };
}

export interface GoalPace {
  currentMonthlyPace: Cents;
  requiredMonthlyPace: Cents | null;
  /** required - current (positive = behind pace). */
  difference: Cents | null;
  onTrack: boolean | null;
  /** Estimated completion date at the current pace (null if pace is zero). */
  projectedCompletion: LocalDate | null;
}

/**
 * Compares the user's recent contribution pace against what is required.
 * `contributions` should be the last ~90 days of contributions.
 */
export function calculateGoalPace(
  progress: GoalProgress,
  contributions: { date: LocalDate; amount: Cents }[],
  today: LocalDate,
  windowDays = 90,
): GoalPace {
  const since = addDays(today, -windowDays);
  const total = sumCents(contributions.filter((c) => c.date > since && c.date <= today).map((c) => c.amount));
  // pace per month = total * 30.4375 / windowDays
  const currentMonthlyPace = Math.max(0, mulDiv(total, 12175, windowDays * 400));
  const required = progress.requiredMonthly;
  let projectedCompletion: LocalDate | null = null;
  if (progress.isComplete) projectedCompletion = today;
  else if (currentMonthlyPace > 0) {
    const days = Math.ceil((progress.remaining * 12175) / (currentMonthlyPace * 400));
    projectedCompletion = addDays(today, days);
  }
  return {
    currentMonthlyPace,
    requiredMonthlyPace: required,
    difference: required === null ? null : required - currentMonthlyPace,
    onTrack: required === null ? null : currentMonthlyPace >= required,
    projectedCompletion,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Savings rate & net worth
// ─────────────────────────────────────────────────────────────────────────────

/** (income - expenses) / income in basis points. Negative when spending exceeds income. */
export function calculateSavingsRate(income: Cents, expenses: Cents): Bps {
  if (income <= 0) return 0;
  return ratioBps(income - expenses, income);
}

export type BalanceClass = "asset" | "liability";

export interface NetWorthInput {
  balance: Cents;
  class: BalanceClass;
  group: "cash" | "investments" | "otherAssets" | "creditCards" | "loans" | "otherLiabilities";
}

export interface NetWorthResult {
  assets: Cents;
  liabilities: Cents;
  netWorth: Cents;
  breakdown: Record<NetWorthInput["group"], Cents>;
}

export function calculateNetWorth(items: NetWorthInput[]): NetWorthResult {
  const breakdown: NetWorthResult["breakdown"] = { cash: 0, investments: 0, otherAssets: 0, creditCards: 0, loans: 0, otherLiabilities: 0 };
  let assets = 0;
  let liabilities = 0;
  for (const item of items) {
    breakdown[item.group] += item.balance;
    if (item.class === "asset") assets += item.balance;
    else liabilities += item.balance;
  }
  return { assets, liabilities, netWorth: assets - liabilities, breakdown };
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe to spend
// ─────────────────────────────────────────────────────────────────────────────

export interface SafeToSpendInput {
  /** Cash available now in spending accounts (chequing/cash; savings excluded by default). */
  availableCash: Cents;
  /** Unpaid bills & expected recurring charges due before the next payday. */
  upcomingBills: Cents;
  /** Budgeted-but-unspent money for essential categories until next payday. */
  reservedBudget: Cents;
  /** Planned goal allocations due before next payday. */
  plannedSavings: Cents;
  /** User-configured minimum cash buffer. */
  minimumBuffer: Cents;
}

export interface SafeToSpendLine {
  key: keyof SafeToSpendInput;
  label: string;
  amount: Cents;
  sign: 1 | -1;
}

export interface SafeToSpendResult {
  safeToSpend: Cents;
  /** Raw value before flooring at zero (negative = shortfall). */
  raw: Cents;
  shortfall: Cents;
  lines: SafeToSpendLine[];
}

/**
 * safe = available cash − upcoming bills − reserved budget − planned savings − minimum buffer.
 * Never reported below zero; a negative raw value is reported as a shortfall instead.
 */
export function calculateSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const lines: SafeToSpendLine[] = [
    { key: "availableCash", label: "Cash available now", amount: input.availableCash, sign: 1 },
    { key: "upcomingBills", label: "Bills and subscriptions before payday", amount: input.upcomingBills, sign: -1 },
    { key: "reservedBudget", label: "Set aside for budgeted essentials", amount: input.reservedBudget, sign: -1 },
    { key: "plannedSavings", label: "Planned savings before payday", amount: input.plannedSavings, sign: -1 },
    { key: "minimumBuffer", label: "Your cash buffer", amount: input.minimumBuffer, sign: -1 },
  ];
  const raw = lines.reduce((acc, l) => acc + l.sign * l.amount, 0);
  return { safeToSpend: Math.max(0, raw), raw, shortfall: raw < 0 ? -raw : 0, lines };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash flow forecast
// ─────────────────────────────────────────────────────────────────────────────

export type CashFlowEventKind = "income" | "bill" | "subscription" | "expense" | "goal";

export interface CashFlowEvent {
  date: LocalDate;
  /** Signed: positive inflow, negative outflow. */
  amount: Cents;
  kind: CashFlowEventKind;
  label: string;
}

export interface CashFlowDay {
  date: LocalDate;
  inflow: Cents;
  outflow: Cents;
  balance: Cents;
  events: CashFlowEvent[];
}

export interface CashFlowResult {
  days: CashFlowDay[];
  startingBalance: Cents;
  endingBalance: Cents;
  lowestBalance: Cents;
  lowestBalanceDate: LocalDate;
  totalInflow: Cents;
  totalOutflow: Cents;
  byKind: Record<CashFlowEventKind, Cents>;
}

/**
 * Projects a daily balance from a starting balance and dated events.
 * `dailyDiscretionary` spreads typical variable spending evenly across days.
 * Results are ESTIMATES and must be labelled as such in the UI.
 */
export function calculateCashFlow(
  startingBalance: Cents,
  events: CashFlowEvent[],
  start: LocalDate,
  days: number,
  dailyDiscretionary: Cents = 0,
): CashFlowResult {
  const byDate = new Map<LocalDate, CashFlowEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const byKind: CashFlowResult["byKind"] = { income: 0, bill: 0, subscription: 0, expense: 0, goal: 0 };
  let balance = startingBalance;
  let lowestBalance = startingBalance;
  let lowestBalanceDate = start;
  let totalInflow = 0;
  let totalOutflow = 0;
  const out: CashFlowDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const dayEvents = [...(byDate.get(date) ?? [])];
    if (dailyDiscretionary > 0) {
      dayEvents.push({ date, amount: -dailyDiscretionary, kind: "expense", label: "Typical day-to-day spending" });
    }
    let inflow = 0;
    let outflow = 0;
    for (const e of dayEvents) {
      if (e.amount >= 0) inflow += e.amount;
      else outflow += -e.amount;
      byKind[e.kind] += e.amount;
    }
    balance += inflow - outflow;
    totalInflow += inflow;
    totalOutflow += outflow;
    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestBalanceDate = date;
    }
    out.push({ date, inflow, outflow, balance, events: dayEvents });
  }
  return { days: out, startingBalance, endingBalance: balance, lowestBalance, lowestBalanceDate, totalInflow, totalOutflow, byKind };
}

// ─────────────────────────────────────────────────────────────────────────────
// Averages
// ─────────────────────────────────────────────────────────────────────────────

/** Integer average rounded half away from zero. */
export function averageCents(values: Cents[]): Cents {
  if (values.length === 0) return 0;
  return mulDiv(sumCents(values), 1, values.length);
}

/** Median (lower-middle average for even counts, rounded). */
export function medianCents(values: Cents[]): Cents {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : mulDiv(sorted[mid - 1] + sorted[mid], 1, 2);
}
