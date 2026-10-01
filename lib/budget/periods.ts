/**
 * Budget periods and the /budget URL scheme. Pure, so server pages, client
 * navigation and tests agree on which period a URL points at.
 *
 *   /budget                          → this month
 *   /budget?month=2026-08            → a month
 *   /budget?period=weekly&week=…     → the week containing that date
 *   /budget?period=custom&id=<uuid>  → a custom budget
 */
import { addDays, addMonthKey, endOfWeek, formatDate, formatMonthKey, isLocalDate, isMonthKey, monthKey, monthRange, startOfWeek, type LocalDate } from "@/lib/dates";

export type BudgetPeriodName = "MONTHLY" | "WEEKLY" | "CUSTOM";

export interface PeriodSelection {
  period: BudgetPeriodName;
  /** First day of the selected month/week (null for custom: the budget decides). */
  start: LocalDate | null;
  end: LocalDate | null;
  /** Custom budget id from the URL, if any. */
  id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Reads the period from search params, falling back to the current month. Never throws. */
export function parsePeriodParams(params: Record<string, string | string[] | undefined>, today: LocalDate, weekStartsOn = 0): PeriodSelection {
  const period = (first(params.period) ?? "").toLowerCase();
  if (period === "custom") {
    const id = first(params.id);
    return { period: "CUSTOM", start: null, end: null, id: id && UUID_RE.test(id) ? id : null };
  }
  if (period === "weekly") {
    const week = first(params.week);
    const anchor = week && isLocalDate(week) ? week : today;
    return { period: "WEEKLY", start: startOfWeek(anchor, weekStartsOn), end: endOfWeek(anchor, weekStartsOn), id: null };
  }
  const month = first(params.month);
  const key = month && isMonthKey(month) ? month : monthKey(today);
  const { start, end } = monthRange(key);
  return { period: "MONTHLY", start, end, id: null };
}

/** The month or week `delta` periods away from `start`. */
export function shiftPeriod(period: "MONTHLY" | "WEEKLY", start: LocalDate, delta: number, weekStartsOn = 0): { start: LocalDate; end: LocalDate } {
  if (period === "MONTHLY") return monthRange(addMonthKey(monthKey(start), delta));
  const s = startOfWeek(addDays(start, delta * 7), weekStartsOn);
  return { start: s, end: endOfWeek(s, weekStartsOn) };
}

/** Link to a budget period on /budget. */
export function budgetHref(sel: { period: BudgetPeriodName; start?: LocalDate | null; id?: string | null }, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (sel.period === "MONTHLY" && sel.start) q.set("month", monthKey(sel.start));
  if (sel.period === "WEEKLY") {
    q.set("period", "weekly");
    if (sel.start) q.set("week", sel.start);
  }
  if (sel.period === "CUSTOM") {
    q.set("period", "custom");
    if (sel.id) q.set("id", sel.id);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return s ? `/budget?${s}` : "/budget";
}

/** "September 2026", "Week of Sep 27, 2026" or "Sep 1 – Sep 14, 2026". */
export function periodLabel(period: BudgetPeriodName, start: LocalDate, end: LocalDate, locale = "en-CA"): string {
  if (period === "MONTHLY") return formatMonthKey(monthKey(start), locale);
  if (period === "WEEKLY") return `Week of ${formatDate(start, "medium", locale)}`;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${sameYear ? formatDate(start, "monthDay", locale) : formatDate(start, "medium", locale)} – ${formatDate(end, "medium", locale)}`;
}

/** Whether `today` falls inside the period, before it or after it. */
export function periodTiming(start: LocalDate, end: LocalDate, today: LocalDate): "past" | "current" | "future" {
  if (today < start) return "future";
  if (today > end) return "past";
  return "current";
}
