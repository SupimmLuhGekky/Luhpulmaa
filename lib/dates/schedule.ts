/**
 * Recurrence schedules for paydays, bills and subscriptions.
 */
import type { Frequency } from "@prisma/client";
import { addDays, addMonths, daysBetween, daysInMonth, type LocalDate } from "./index";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  IRREGULAR: "Irregular",
  ONE_TIME: "One time",
};

export const FREQUENCY_SHORT: Record<Frequency, string> = {
  WEEKLY: "/wk",
  BIWEEKLY: "/2 wk",
  SEMI_MONTHLY: "/half-mo",
  MONTHLY: "/mo",
  QUARTERLY: "/qtr",
  YEARLY: "/yr",
  IRREGULAR: "",
  ONE_TIME: "",
};

/** Nominal interval in days, used for detection tolerances. */
export const FREQUENCY_DAYS: Record<Frequency, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  SEMI_MONTHLY: 15,
  MONTHLY: 30,
  QUARTERLY: 91,
  YEARLY: 365,
  IRREGULAR: 30,
  ONE_TIME: 0,
};

/** Number of occurrences per year (exact integers where possible). */
export const OCCURRENCES_PER_YEAR: Record<Frequency, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
  QUARTERLY: 4,
  YEARLY: 1,
  IRREGULAR: 12,
  ONE_TIME: 0,
};

function semiMonthlyDate(year: number, month1: number, day: number): LocalDate {
  const d = Math.min(day, daysInMonth(year, month1));
  return `${year}-${String(month1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * All occurrences of a schedule in [from, to] (inclusive).
 * `anchor` is a known occurrence (first due date / a past payday).
 */
export function occurrencesBetween(
  anchor: LocalDate,
  frequency: Frequency,
  from: LocalDate,
  to: LocalDate,
  opts: { semiMonthlyDays?: number[]; endDate?: LocalDate | null; limit?: number } = {},
): LocalDate[] {
  const out: LocalDate[] = [];
  const limit = opts.limit ?? 1000;
  const end = opts.endDate && opts.endDate < to ? opts.endDate : to;
  if (end < from) return out;

  const push = (d: LocalDate) => {
    if (d >= from && d <= end && d >= anchor) out.push(d);
  };

  switch (frequency) {
    case "ONE_TIME":
      push(anchor);
      break;
    case "WEEKLY":
    case "BIWEEKLY": {
      const step = frequency === "WEEKLY" ? 7 : 14;
      let d = anchor;
      if (d < from) {
        const skip = Math.floor(daysBetween(d, from) / step);
        d = addDays(d, skip * step);
      }
      while (d <= end && out.length < limit) {
        push(d);
        d = addDays(d, step);
      }
      break;
    }
    case "SEMI_MONTHLY": {
      const days = [...(opts.semiMonthlyDays?.length ? opts.semiMonthlyDays : [15, 31])].sort((a, b) => a - b);
      let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
      while (out.length < limit) {
        const monthStart = semiMonthlyDate(y, m, 1);
        if (monthStart > end) break;
        for (const day of days) push(semiMonthlyDate(y, m, day));
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      break;
    }
    case "MONTHLY":
    case "QUARTERLY":
    case "YEARLY":
    case "IRREGULAR": {
      const stepMonths = frequency === "QUARTERLY" ? 3 : frequency === "YEARLY" ? 12 : 1;
      const anchorDay = Number(anchor.slice(8, 10));
      let i = 0;
      if (anchor < from) {
        const monthsApart =
          (Number(from.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 + (Number(from.slice(5, 7)) - Number(anchor.slice(5, 7)));
        i = Math.max(0, Math.floor(monthsApart / stepMonths) - 1);
      }
      while (out.length < limit) {
        const d = addMonths(anchor, i * stepMonths, anchorDay);
        if (d > end) break;
        push(d);
        i += 1;
      }
      break;
    }
  }
  return out;
}

/** The first occurrence on or after `onOrAfter`. */
export function nextOccurrence(
  anchor: LocalDate,
  frequency: Frequency,
  onOrAfter: LocalDate,
  opts: { semiMonthlyDays?: number[]; endDate?: LocalDate | null } = {},
): LocalDate | null {
  if (frequency === "ONE_TIME") return anchor >= onOrAfter ? anchor : null;
  const horizon = addDays(onOrAfter, 400);
  const [first] = occurrencesBetween(anchor, frequency, onOrAfter, horizon, { ...opts, limit: 1 });
  return first ?? null;
}
