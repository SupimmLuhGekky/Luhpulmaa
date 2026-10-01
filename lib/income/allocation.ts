/**
 * Paycheque split preview for allocation plans. Pure (no database, no clock) so the
 * income page can show a live preview in the browser with exactly the numbers the
 * server records when a plan is applied.
 */
import { allocateByWeights, mulDiv, type Cents } from "@/lib/finance/money";

export interface AllocationItemInput {
  label: string;
  method: "PERCENT" | "FIXED";
  percentBps?: number | null;
  amountCents?: number | null;
  goalId?: string | null;
  categoryId?: string | null;
}

export interface AllocationLine {
  label: string;
  /** What this line receives from the paycheque. */
  amount: Cents;
  /** What the line asked for (its fixed amount, or its percentage of the paycheque) before any scaling down. */
  requested: Cents;
  method: "PERCENT" | "FIXED";
  percentBps: number | null;
  goalId: string | null;
  categoryId: string | null;
}

export interface AllocationPreview {
  lines: AllocationLine[];
  /** Part of the paycheque no line claims (never negative). */
  unallocated: Cents;
  totalPercentBps: number;
  /** Sum of what lines asked for but could not get because the paycheque ran out. */
  shortfall: Cents;
  /** The plan asks for more than the paycheque (percentages above 100% or fixed amounts that don't fit). */
  overAllocated: boolean;
}

/**
 * Splits a paycheque: fixed amounts first (in order, each capped by what is left),
 * then percentages of the whole paycheque, scaled down proportionally when the
 * fixed lines leave too little. Every amount is integer cents and the lines plus
 * `unallocated` always add up to the paycheque.
 */
export function previewAllocation(income: Cents, items: AllocationItemInput[]): AllocationPreview {
  const paycheque = Math.max(0, income);
  let remaining = paycheque;
  const lines: AllocationLine[] = items.map((i) => ({
    label: i.label,
    amount: 0,
    requested: i.method === "FIXED" ? Math.max(0, i.amountCents ?? 0) : mulDiv(paycheque, Math.max(0, i.percentBps ?? 0), 10000),
    method: i.method,
    percentBps: i.method === "PERCENT" ? (i.percentBps ?? 0) : null,
    goalId: i.goalId ?? null,
    categoryId: i.categoryId ?? null,
  }));
  lines.forEach((line) => {
    if (line.method !== "FIXED") return;
    line.amount = Math.min(line.requested, remaining);
    remaining -= line.amount;
  });
  const percentLines = lines.filter((l) => l.method === "PERCENT");
  const wanted = percentLines.map((l) => l.requested);
  const totalWanted = wanted.reduce((a, b) => a + b, 0);
  const granted = totalWanted <= remaining ? wanted : allocateByWeights(remaining, wanted);
  percentLines.forEach((line, k) => {
    line.amount = granted[k];
    remaining -= granted[k];
  });
  const totalPercentBps = percentLines.reduce((a, l) => a + (l.percentBps ?? 0), 0);
  const shortfall = lines.reduce((a, l) => a + (l.requested - l.amount), 0);
  return { lines, unallocated: remaining, totalPercentBps, shortfall, overAllocated: totalPercentBps > 10000 || shortfall > 0 };
}
