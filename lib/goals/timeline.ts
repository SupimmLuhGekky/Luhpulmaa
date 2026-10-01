/**
 * Dates on a numeric chart axis. The goal growth chart plots days as numbers so the
 * gaps between contributions keep their real length. Pure, client-safe.
 */
import { addMonthKey, monthKey, type LocalDate } from "@/lib/dates";

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a "YYYY-MM-DD" date. */
export function dayNumber(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): LocalDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export interface TimeTicks {
  /** Tick dates inside [from, to], oldest first. */
  ticks: LocalDate[];
  /** "month" ticks fall on month starts; "day" ticks are evenly spaced days. */
  unit: "month" | "day";
}

const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 60];

/**
 * At most `max` readable ticks between two dates: month starts on a 1/2/3/6/12-month
 * rhythm for ranges of two months or more (Jan, Apr, Jul… for quarterly), otherwise
 * evenly spaced days.
 */
export function timeTicks(from: LocalDate, to: LocalDate, max = 5): TimeTicks {
  const span = dayNumber(to) - dayNumber(from);
  if (span >= 60) {
    const starts: LocalDate[] = [];
    let m = monthKey(from);
    if (`${m}-01` < from) m = addMonthKey(m, 1);
    for (; `${m}-01` <= to; m = addMonthKey(m, 1)) starts.push(`${m}-01`);
    const index = (d: LocalDate) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
    for (const step of MONTH_STEPS) {
      const picked = starts.filter((d) => index(d) % step === 0);
      if (picked.length <= max) return { ticks: picked.length ? picked : starts.slice(0, 1), unit: "month" };
    }
    return { ticks: starts.slice(0, 1), unit: "month" };
  }
  if (span <= 0) return { ticks: [from], unit: "day" };
  const n = Math.min(max, span + 1);
  const start = dayNumber(from);
  const ticks = Array.from({ length: n }, (_, i) => fromDayNumber(start + Math.round((i * span) / (n - 1))));
  return { ticks: [...new Set(ticks)], unit: "day" };
}
