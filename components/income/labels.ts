/** Display labels for pay schedules. */
export type PayFrequency = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY";

export const FREQUENCY_LABEL: Record<PayFrequency, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
};

export function frequencyLabel(f: string): string {
  return FREQUENCY_LABEL[f as PayFrequency] ?? f.charAt(0) + f.slice(1).toLowerCase().replace(/_/g, " ");
}

/** "15th", "1st", or "last day" (31 means the last day of the month). */
export function dayOfMonthLabel(day: number): string {
  if (day >= 31) return "last day";
  const s = day % 100 >= 11 && day % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${day}${s}`;
}

/** "Twice a month · 15th and last day" for semi-monthly schedules, otherwise the frequency. */
export function scheduleLabel(frequency: string, semiMonthlyDays: number[]): string {
  if (frequency === "SEMI_MONTHLY" && semiMonthlyDays.length === 2) {
    const [a, b] = [...semiMonthlyDays].sort((x, y) => x - y);
    return `Twice a month · ${dayOfMonthLabel(a)} and ${dayOfMonthLabel(b)}`;
  }
  return frequencyLabel(frequency);
}
