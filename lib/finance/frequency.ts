import type { Frequency } from "@prisma/client";
import { OCCURRENCES_PER_YEAR } from "@/lib/dates/schedule";
import { mulDiv, type Cents } from "./money";

/** Converts a per-occurrence amount to its monthly equivalent (e.g. biweekly $1,420 → $3,076.67). */
export function monthlyEquivalent(amount: Cents, frequency: Frequency): Cents {
  if (frequency === "ONE_TIME") return 0;
  return mulDiv(amount, OCCURRENCES_PER_YEAR[frequency], 12);
}

/** Converts a per-occurrence amount to its yearly equivalent. */
export function yearlyEquivalent(amount: Cents, frequency: Frequency): Cents {
  if (frequency === "ONE_TIME") return 0;
  return amount * OCCURRENCES_PER_YEAR[frequency];
}
