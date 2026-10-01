/**
 * Price-change hint for a subscription (pure). Compares the two most recent charges
 * of its recurring series; reports a change only when it is clearly more than
 * rounding or tax noise. The hint naturally disappears once two charges in a row
 * have the new price.
 */
import type { LocalDate } from "@/lib/dates";
import type { Cents } from "@/lib/finance/money";

export interface PriceChange {
  previousCents: Cents;
  currentCents: Cents;
  /** Date of the first charge at the new price. */
  changedOn: LocalDate;
}

export function detectPriceChange(
  charges: { date: LocalDate; amountCents: Cents }[],
  opts: { minCents?: number; minBps?: number } = {},
): PriceChange | null {
  const minCents = opts.minCents ?? 50;
  const minBps = opts.minBps ?? 200; // 2%
  // One charge per day (split or duplicate same-day rows are summed).
  const byDay = new Map<LocalDate, Cents>();
  for (const c of charges) byDay.set(c.date, (byDay.get(c.date) ?? 0) + Math.abs(c.amountCents));
  const days = [...byDay.keys()].sort();
  if (days.length < 2) return null;
  const last = days[days.length - 1];
  const prev = days[days.length - 2];
  const currentCents = byDay.get(last)!;
  const previousCents = byDay.get(prev)!;
  const diff = Math.abs(currentCents - previousCents);
  if (diff < minCents || diff * 10_000 < previousCents * minBps) return null;
  return { previousCents, currentCents, changedOn: last };
}
