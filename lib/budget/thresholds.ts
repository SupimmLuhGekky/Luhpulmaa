/**
 * Budget alert thresholds (percent of a line's available amount). Pure so the budget
 * page shows exactly the alert state the daily job notifies about.
 */
import type { Bps } from "@/lib/finance/money";

/** Quick picks offered in the line editor; any whole percent from 1 to 200 is allowed. */
export const THRESHOLD_PRESETS = [50, 75, 80, 90, 100] as const;
export const MAX_THRESHOLDS = 6;
export const MIN_THRESHOLD = 1;
export const MAX_THRESHOLD = 200;

/** Unique, sorted, whole percents within 1–200, at most six. */
export function normalizeThresholds(values: number[]): number[] {
  const valid = values.filter((v) => Number.isInteger(v) && v >= MIN_THRESHOLD && v <= MAX_THRESHOLD);
  return [...new Set(valid)].sort((a, b) => a - b).slice(0, MAX_THRESHOLDS);
}

/**
 * The highest threshold a line has crossed, or null. Thresholds below 100% fire once
 * reached; 100% and above fire only when exceeded, so a line that is exactly on
 * budget doesn't raise an alarm.
 */
export function crossedThreshold(usedBps: Bps, thresholds: number[]): number | null {
  const usedPercent = Math.floor(usedBps / 100);
  const crossed = thresholds.filter((t) => (t < 100 ? usedPercent >= t : usedBps > t * 100));
  return crossed.length ? Math.max(...crossed) : null;
}

/** The next threshold the line will cross, or null when all are behind it. */
export function nextThreshold(usedBps: Bps, thresholds: number[]): number | null {
  const crossed = crossedThreshold(usedBps, thresholds);
  const ahead = [...thresholds].sort((a, b) => a - b).filter((t) => crossed === null || t > crossed);
  return ahead[0] ?? null;
}
