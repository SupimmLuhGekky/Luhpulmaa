import { addDays, addMonths, addYears, endOfMonth, maxDate, minDate, monthKey, startOfMonth, type LocalDate } from "@/lib/dates";
import type { Analytics } from "@/lib/analytics/service";

export type Bucket = "day" | "week" | "month";
export interface SeriesPoint {
  period: string;
  income: number;
  spending: number;
}

const utc = (d: LocalDate) => new Date(`${d}T00:00:00Z`);

/** "Sep 1 – 30, 2026" (en-CA) or "1–30 sept. 2026" (fr-CA): the locale decides how ranges read. */
export function formatDateRange(from: LocalDate, to: LocalDate, locale: string, opts: { year?: boolean } = {}): string {
  const f = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", day: "numeric", year: opts.year === false ? undefined : "numeric" });
  return from === to ? f.format(utc(from)) : f.formatRange(utc(from), utc(to));
}

/** First and last day a series bucket covers, clipped to the range being shown. */
export function bucketSpan(period: string, bucket: Bucket, clip: { from: LocalDate; to: LocalDate }): { start: LocalDate; end: LocalDate } {
  const start = bucket === "month" ? `${period}-01` : period;
  const end = bucket === "month" ? endOfMonth(start) : bucket === "week" ? addDays(start, 6) : start;
  return { start: maxDate(start, clip.from), end: minDate(end, clip.to) };
}

/** Drops leading buckets that end before the first transaction: they have no data, not zero. */
export function trimBeforeHistory<T extends SeriesPoint>(series: T[], bucket: Bucket, since: LocalDate | null): T[] {
  if (!since) return [];
  const i = series.findIndex((p) => bucketSpan(p.period, bucket, { from: "0000-01-01", to: "9999-12-31" }).end >= since);
  return i < 0 ? [] : series.slice(i);
}

/** Number of complete months behind the average monthly spending (same rule as the service). */
export function completeMonthsSince(monthly: SeriesPoint[], since: LocalDate | null, today: LocalDate, count = 6): number {
  if (!since) return 0;
  return Math.min(count, monthly.filter((m) => m.period >= monthKey(since) && m.period < monthKey(today)).length);
}

/** The whole calendar period before the current one, for "show last month" style shortcuts. */
export function previousFullPeriod(range: Analytics["range"], kind: string): { from: LocalDate; to: LocalDate } {
  const end = addDays(range.from, -1);
  switch (kind) {
    case "week":
      return { from: addDays(range.from, -7), to: end };
    case "month":
      return { from: startOfMonth(end), to: end };
    case "quarter":
      return { from: addMonths(range.from, -3), to: end };
    case "year":
      return { from: addYears(range.from, -1), to: end };
    default:
      return { from: range.previousFrom, to: range.previousTo };
  }
}

export const PREVIOUS_LABEL: Record<string, string> = { week: "Show last week", month: "Show last month", quarter: "Show last quarter", year: "Show last year", custom: "Show the period before" };

/** Share of a total as a short label ("43%", "<1%"). */
export function shareLabel(bps: number): string {
  if (bps <= 0) return "0%";
  if (bps < 50) return "<1%";
  return `${Math.round(bps / 100)}%`;
}

/** Replaces ISO dates inside a sentence with readable ones ("2026-09-01" → "Sep 1, 2026"). */
export function readableDates(text: string, format: (d: LocalDate) => string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => format(d));
}

/** Link to the transactions list narrowed to what a row represents. */
export function transactionsHref(range: { from: LocalDate; to: LocalDate }, extra: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  p.set("from", range.from);
  p.set("to", range.to);
  return `/transactions?${p.toString()}`;
}
