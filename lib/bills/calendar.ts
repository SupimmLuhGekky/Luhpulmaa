/**
 * Bill calendar helpers (pure: used by the /bills page on the server and client).
 */
import { addDays, addMonths, endOfMonth, isLocalDate, startOfMonth, startOfWeek, type LocalDate } from "@/lib/dates";

export const CALENDAR_VIEWS = ["month", "week", "list"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export type OccurrenceStatus = "paid" | "overdue" | "due-today" | "upcoming";

/** Paid wins; otherwise a due date before today is overdue. */
export function occurrenceStatus(o: { paid: boolean; dueDate: LocalDate }, today: LocalDate): OccurrenceStatus {
  if (o.paid) return "paid";
  if (o.dueDate < today) return "overdue";
  if (o.dueDate === today) return "due-today";
  return "upcoming";
}

/** Weeks (rows of 7 dates) covering the month that contains `date`. */
export function monthGrid(date: LocalDate, weekStartsOn = 0): LocalDate[][] {
  const last = endOfMonth(date);
  const weeks: LocalDate[][] = [];
  let d = startOfWeek(startOfMonth(date), weekStartsOn);
  while (d <= last) {
    const week: LocalDate[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(d);
      d = addDays(d, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** The 7 dates of the week containing `date`. */
export function weekDates(date: LocalDate, weekStartsOn = 0): LocalDate[] {
  const start = startOfWeek(date, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Dates whose bills a view needs (the month view includes the leading/trailing days it shows). */
export function viewRange(view: CalendarView, date: LocalDate, weekStartsOn = 0): { from: LocalDate; to: LocalDate } {
  if (view === "week") {
    const days = weekDates(date, weekStartsOn);
    return { from: days[0], to: days[6] };
  }
  if (view === "month") {
    const grid = monthGrid(date, weekStartsOn);
    return { from: grid[0][0], to: grid[grid.length - 1][6] };
  }
  return { from: startOfMonth(date), to: endOfMonth(date) };
}

/** Moves the calendar by whole weeks (week view) or months (month and list views). */
export function shiftDate(view: CalendarView, date: LocalDate, delta: number): LocalDate {
  return view === "week" ? addDays(date, 7 * delta) : addMonths(startOfMonth(date), delta);
}

/** Reads `?view=` and `?date=` defensively. */
export function parseCalendarParams(params: { view?: string | string[]; date?: string | string[] }, today: LocalDate): { view: CalendarView; date: LocalDate } {
  const view = typeof params.view === "string" && (CALENDAR_VIEWS as readonly string[]).includes(params.view) ? (params.view as CalendarView) : "month";
  const date = typeof params.date === "string" && isLocalDate(params.date) ? params.date : today;
  return { view, date };
}

/**
 * Window for "money needed before payday": from today up to the day before the next
 * expected payday (14 days when no payday is known), like safe-to-spend.
 */
export function paydayWindow(today: LocalDate, nextPayday: LocalDate | null): { from: LocalDate; to: LocalDate } {
  const horizon = nextPayday ?? addDays(today, 14);
  const end = addDays(horizon, -1);
  return { from: today, to: end < today ? today : end };
}

export interface OccurrenceTotals {
  count: number;
  total: number;
  paidCount: number;
  paidTotal: number;
  unpaidTotal: number;
  overdueCount: number;
  overdueTotal: number;
}

export function summarizeOccurrences(list: { paid: boolean; dueDate: LocalDate; amountCents: number }[], today: LocalDate): OccurrenceTotals {
  const t: OccurrenceTotals = { count: 0, total: 0, paidCount: 0, paidTotal: 0, unpaidTotal: 0, overdueCount: 0, overdueTotal: 0 };
  for (const o of list) {
    t.count++;
    t.total += o.amountCents;
    if (o.paid) {
      t.paidCount++;
      t.paidTotal += o.amountCents;
    } else {
      t.unpaidTotal += o.amountCents;
      if (o.dueDate < today) {
        t.overdueCount++;
        t.overdueTotal += o.amountCents;
      }
    }
  }
  return t;
}
