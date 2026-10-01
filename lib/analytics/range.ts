/**
 * Analytics query parsing and period resolution (pure: safe for unit tests and
 * client components).
 */
import { z } from "zod";
import { addDays, addMonths, addMonthKey, addYears, daysBetween, endOfMonth, isLocalDate, minDate, monthKey, startOfMonth, startOfQuarter, startOfWeek, startOfYear, type LocalDate } from "@/lib/dates";

export const ANALYTICS_RANGES = ["week", "month", "quarter", "year", "custom"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

const localDate = z.string().refine(isLocalDate, "Use a valid YYYY-MM-DD date");

/** Ids as a comma-separated string (query strings) or an array. */
const idList = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : v,
  z.array(z.string().uuid()).max(100),
);

export const analyticsQuerySchema = z.object({
  range: z.enum(ANALYTICS_RANGES).default("month"),
  from: localDate.optional(),
  to: localDate.optional(),
  /** Only these accounts (all accounts when absent or empty). */
  accounts: idList.optional(),
  /** Only these categories (all categories when absent or empty). */
  categories: idList.optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const uuid = z.string().uuid();

/**
 * Reads a page's query string one field at a time, so a bad value (a mistyped date,
 * a stale id) is dropped on its own instead of discarding every other filter.
 */
export function analyticsQueryFromParams(params: Record<string, string | string[] | undefined>): AnalyticsQuery {
  const read = (key: string) => {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s === undefined || s === "" ? undefined : s;
  };
  const ids = (key: string) => {
    const list = (read(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => uuid.safeParse(s).success);
    return list.length ? [...new Set(list)].slice(0, 100) : undefined;
  };
  const range = z.enum(ANALYTICS_RANGES).safeParse(read("range"));
  const from = read("from");
  const to = read("to");
  return analyticsQuerySchema.parse({
    range: range.success ? range.data : undefined,
    from: from && isLocalDate(from) ? from : undefined,
    to: to && isLocalDate(to) ? to : undefined,
    accounts: ids("accounts"),
    categories: ids("categories"),
  });
}

export interface ResolvedRange {
  from: LocalDate;
  to: LocalDate;
  previousFrom: LocalDate;
  previousTo: LocalDate;
  /** "This month", "Custom range"… */
  label: string;
  /** Used inside sentences: "this month", "in this period". */
  periodPhrase: string;
  /** What the previous period is: "the same days last month", "the previous 14 days". */
  comparisonLabel: string;
}

const LABELS: Record<AnalyticsRange, string> = { week: "This week", month: "This month", quarter: "This quarter", year: "This year", custom: "Custom range" };

/**
 * Resolves a query to a date range and the period it is compared with. Presets are
 * period-to-date and compare with the same stretch of the previous week/month/
 * quarter/year; a custom range compares with the equally long stretch just before it.
 * A reversed custom range is swapped, so a range always has at least one day.
 */
export function resolveRange(q: Pick<AnalyticsQuery, "range" | "from" | "to">, today: LocalDate, weekStartsOn = 0): ResolvedRange {
  let from: LocalDate;
  let to: LocalDate = today;
  let previousFrom: LocalDate;
  let previousTo: LocalDate;
  let comparisonLabel: string;
  switch (q.range) {
    case "week":
      from = startOfWeek(today, weekStartsOn);
      previousFrom = addDays(from, -7);
      previousTo = addDays(to, -7);
      comparisonLabel = "the same days last week";
      break;
    case "quarter":
      from = startOfQuarter(today);
      previousFrom = addMonths(from, -3);
      previousTo = minDate(addMonths(to, -3), addDays(from, -1));
      comparisonLabel = "the same period last quarter";
      break;
    case "year":
      from = startOfYear(today);
      previousFrom = addYears(from, -1);
      previousTo = addYears(to, -1);
      comparisonLabel = "the same period last year";
      break;
    case "custom": {
      const a = q.from ?? addDays(today, -29);
      const b = q.to ?? today;
      [from, to] = a <= b ? [a, b] : [b, a];
      const len = daysBetween(from, to) + 1;
      previousFrom = addDays(from, -len);
      previousTo = addDays(from, -1);
      comparisonLabel = len === 1 ? "the day before" : `the previous ${len} days`;
      break;
    }
    default:
      from = startOfMonth(today);
      previousFrom = addMonths(from, -1);
      previousTo = minDate(addMonths(to, -1), endOfMonth(previousFrom));
      comparisonLabel = "the same days last month";
  }
  const range = q.range ?? "month";
  return {
    from,
    to,
    previousFrom,
    previousTo,
    label: LABELS[range],
    periodPhrase: range === "custom" ? "in this period" : LABELS[range].toLowerCase(),
    comparisonLabel,
  };
}

/** Chart bucket for a range length: days up to a month, weeks up to ~4 months, then months. */
export function bucketFor(days: number): "day" | "week" | "month" {
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

/**
 * Completes an income/spending series with zero rows for periods without
 * transactions, so time charts keep an even time axis. Period keys match the SQL
 * buckets: "YYYY-MM-DD" days, ISO weeks starting on Monday, "YYYY-MM" months.
 */
export function fillSeries<T extends { period: string; income: number; spending: number }>(
  series: T[],
  from: LocalDate,
  to: LocalDate,
  bucket: "day" | "week" | "month",
): { period: string; income: number; spending: number }[] {
  const byPeriod = new Map(series.map((r) => [r.period, r]));
  const keys: string[] = [];
  if (bucket === "month") {
    for (let k = monthKey(from); k <= monthKey(to); k = addMonthKey(k, 1)) keys.push(k);
  } else {
    const step = bucket === "week" ? 7 : 1;
    for (let d = bucket === "week" ? startOfWeek(from, 1) : from; d <= to; d = addDays(d, step)) keys.push(d);
  }
  return keys.map((period) => {
    const r = byPeriod.get(period);
    return { period, income: r?.income ?? 0, spending: r?.spending ?? 0 };
  });
}

/**
 * How much of the comparison period has data, given the date of the first
 * transaction: "none" when history starts after it (a change would only show that
 * the data is new), "partial" when history starts inside it.
 */
export function comparisonCoverage(range: { previousFrom: LocalDate; previousTo: LocalDate }, since: LocalDate | null): "full" | "partial" | "none" {
  if (!since || since > range.previousTo) return "none";
  return since > range.previousFrom ? "partial" : "full";
}

/**
 * Average monthly spending over the last `count` complete months, leaving out months
 * before the first transaction (they have no data, not zero spending).
 */
export function averageMonthlySpending(monthly: { period: string; spending: number }[], since: LocalDate | null, today: LocalDate, count = 6): number {
  if (!since) return 0;
  const first = monthKey(since);
  const months = monthly.filter((m) => m.period >= first && m.period < monthKey(today)).slice(-count);
  return months.length ? Math.round(months.reduce((a, m) => a + m.spending, 0) / months.length) : 0;
}
