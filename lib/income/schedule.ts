/**
 * Payday schedule for one income source. Pure, so the estimate shown on the income
 * page and the paydays used by the forecast always agree.
 */
import type { Frequency } from "@prisma/client";
import { addDays, daysBetween, type LocalDate } from "@/lib/dates";
import { occurrencesBetween } from "@/lib/dates/schedule";
import type { Cents } from "@/lib/finance/money";

export interface PayScheduleSource {
  id: string;
  name: string;
  frequency: Frequency;
  averageAmountCents: Cents;
  lastPaidDate: LocalDate | null;
  nextExpectedDate: LocalDate | null;
  semiMonthlyDays: number[];
}

export interface ExpectedPayday {
  date: LocalDate;
  amount: Cents;
  name: string;
  sourceId: string;
}

/** A paycheque that arrives up to this many days early still counts for its expected date. */
export const EARLY_PAY_DAYS = 3;

/**
 * Expected paydays in [from, to]. The schedule is anchored on the next expected date
 * (which the user may have corrected by hand) and falls back to the last payday. The
 * last payday is never repeated as an upcoming one, and neither is an expected date
 * that a paycheque already covered by arriving a few days early.
 */
export function paydaysBetween(source: PayScheduleSource, from: LocalDate, to: LocalDate): ExpectedPayday[] {
  const anchor = source.nextExpectedDate ?? source.lastPaidDate;
  if (!anchor || to < from) return [];
  const last = source.lastPaidDate;
  return occurrencesBetween(anchor, source.frequency, from, to, { semiMonthlyDays: source.semiMonthlyDays })
    .filter((d) => {
      if (!last) return true;
      const gap = daysBetween(last, d);
      return gap < 0 || gap > EARLY_PAY_DAYS;
    })
    .map((date) => ({ date, amount: source.averageAmountCents, name: source.name, sourceId: source.id }));
}

/** The first expected payday on or after `onOrAfter` (within about a year), or null. */
export function nextPayday(source: PayScheduleSource, onOrAfter: LocalDate): LocalDate | null {
  return paydaysBetween(source, onOrAfter, addDays(onOrAfter, 400))[0]?.date ?? null;
}
