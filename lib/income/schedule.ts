/**
 * Payday schedule for one income source. Pure, so the estimate shown on the income
 * page and the paydays used by the forecast always agree.
 */
import type { Frequency } from "@prisma/client";
import { addDays, type LocalDate } from "@/lib/dates";
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

/**
 * Expected paydays in [from, to]. The schedule is anchored on the next expected date
 * (which the user may have corrected by hand) and falls back to the last payday; the
 * last payday itself is never repeated as an upcoming one.
 */
export function paydaysBetween(source: PayScheduleSource, from: LocalDate, to: LocalDate): ExpectedPayday[] {
  const anchor = source.nextExpectedDate ?? source.lastPaidDate;
  if (!anchor || to < from) return [];
  return occurrencesBetween(anchor, source.frequency, from, to, { semiMonthlyDays: source.semiMonthlyDays })
    .filter((d) => d !== source.lastPaidDate)
    .map((date) => ({ date, amount: source.averageAmountCents, name: source.name, sourceId: source.id }));
}

/** The first expected payday on or after `onOrAfter` (within about a year), or null. */
export function nextPayday(source: PayScheduleSource, onOrAfter: LocalDate): LocalDate | null {
  return paydaysBetween(source, onOrAfter, addDays(onOrAfter, 400))[0]?.date ?? null;
}
