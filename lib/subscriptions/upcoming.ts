/**
 * Upcoming subscription charges (pure: used by the /subscriptions page and tests).
 */
import type { Frequency } from "@prisma/client";
import { addDays, type LocalDate } from "@/lib/dates";
import { occurrencesBetween } from "@/lib/dates/schedule";

/** Frequencies a subscription can be saved with. */
export const SUBSCRIPTION_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

export interface UpcomingCharge {
  id: string;
  name: string;
  date: LocalDate;
  amountCents: number;
}

/**
 * Expected charges of active subscriptions from `today` through `today + days − 1`,
 * repeating each one's schedule from its next charge date. Estimates: the real
 * charge can move by a day or change price.
 */
export function upcomingCharges(
  subs: { id: string; name: string; amountCents: number; frequency: Frequency; nextChargeDate: LocalDate | null; status: string }[],
  today: LocalDate,
  days = 30,
): UpcomingCharge[] {
  const end = addDays(today, Math.max(1, days) - 1);
  const out: UpcomingCharge[] = [];
  for (const s of subs) {
    if (s.status !== "ACTIVE" || !s.nextChargeDate) continue;
    for (const date of occurrencesBetween(s.nextChargeDate, s.frequency, today, end)) out.push({ id: s.id, name: s.name, date, amountCents: s.amountCents });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}
