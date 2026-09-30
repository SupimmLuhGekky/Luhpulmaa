/**
 * Calendar-date utilities.
 *
 * Financial dates (transaction dates, due dates, paydays, deadlines) are calendar
 * days, not instants. They are represented as ISO "YYYY-MM-DD" strings (`LocalDate`)
 * and all arithmetic is done on UTC midnights so that time zones and DST can never
 * shift a date by one. The only place a time zone matters is deciding what "today"
 * is for a user, which `todayIn(timeZone)` answers with the IANA tz database via Intl.
 */

export type LocalDate = string; // "YYYY-MM-DD"

export const DEFAULT_TIME_ZONE = "America/Toronto";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
}

function parts(date: LocalDate): [number, number, number] {
  const m = ISO_RE.exec(date);
  if (!m) throw new RangeError(`Invalid LocalDate: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toUtc(date: LocalDate): Date {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): LocalDate {
  return date.toISOString().slice(0, 10);
}

/** Converts a LocalDate to the Date object Prisma expects for a @db.Date column. */
export function toDbDate(date: LocalDate): Date {
  return toUtc(date);
}

/** Converts a @db.Date value read from Prisma back to a LocalDate. */
export function fromDbDate(date: Date): LocalDate;
export function fromDbDate(date: Date | null | undefined): LocalDate | null;
export function fromDbDate(date: Date | null | undefined): LocalDate | null {
  if (!date) return null;
  return fromUtc(date);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date "now" in the given IANA time zone. */
export function todayIn(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): LocalDate {
  return dateInZone(now, timeZone);
}

/** The calendar date of an instant in the given time zone. */
export function dateInZone(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalDate {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Adds months, clamping the day to the end of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: LocalDate, months: number, preferredDay?: number): LocalDate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(preferredDay ?? d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addYears(date: LocalDate, years: number): LocalDate {
  return addMonths(date, years * 12);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: LocalDate): LocalDate {
  const [y, m] = parts(date);
  return `${date.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

/** "2026-10" */
export type MonthKey = string;

export function monthKey(date: LocalDate): MonthKey {
  return date.slice(0, 7);
}

export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthRange(key: MonthKey): { start: LocalDate; end: LocalDate } {
  const start = `${key}-01`;
  return { start, end: endOfMonth(start) };
}

export function addMonthKey(key: MonthKey, months: number): MonthKey {
  return monthKey(addMonths(`${key}-01`, months));
}

/** Day of week, 0 = Sunday. */
export function dayOfWeek(date: LocalDate): number {
  return toUtc(date).getUTCDay();
}

export function startOfWeek(date: LocalDate, weekStartsOn = 0): LocalDate {
  const diff = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

export function endOfWeek(date: LocalDate, weekStartsOn = 0): LocalDate {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

export function startOfYear(date: LocalDate): LocalDate {
  return `${date.slice(0, 4)}-01-01`;
}

export function startOfQuarter(date: LocalDate): LocalDate {
  const [y, m] = parts(date);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, "0")}-01`;
}

export function isWithin(date: LocalDate, start: LocalDate, end: LocalDate): boolean {
  return date >= start && date <= end;
}

/** Iterates each calendar day from start to end inclusive. */
export function eachDay(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function eachMonth(start: LocalDate, end: LocalDate): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = monthKey(start); k <= monthKey(end); k = addMonthKey(k, 1)) out.push(k);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    dateFormatters.set(key, f);
  }
  return f;
}

export type DateStyle = "short" | "medium" | "long" | "monthDay" | "monthYear" | "month" | "weekdayShort";

const STYLE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { year: "numeric", month: "2-digit", day: "2-digit" },
  medium: { year: "numeric", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
  monthDay: { month: "short", day: "numeric" },
  monthYear: { year: "numeric", month: "long" },
  month: { month: "short" },
  weekdayShort: { weekday: "short", month: "short", day: "numeric" },
};

/** Formats a LocalDate ("2026-10-01") for display, e.g. "Oct 1, 2026" in en-CA. */
export function formatDate(date: LocalDate | null | undefined, style: DateStyle = "medium", locale = "en-CA"): string {
  if (!date) return "—";
  return dateFormatter(locale, STYLE_OPTIONS[style]).format(toUtc(date));
}

export function formatMonthKey(key: MonthKey, locale = "en-CA", style: "long" | "short" = "long"): string {
  return dateFormatter(locale, style === "long" ? STYLE_OPTIONS.monthYear : { month: "short", year: "2-digit" }).format(
    toUtc(`${key}-01`),
  );
}

/** "Today", "Tomorrow", "In 3 days", "Yesterday", or a date. */
export function formatRelativeDay(date: LocalDate, today: LocalDate, locale = "en-CA"): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff <= 6) return `In ${diff} days`;
  return formatDate(date, "monthDay", locale);
}

/** Formats an instant (e.g. createdAt) in the user's time zone. */
export function formatDateTime(instant: Date | string, timeZone = DEFAULT_TIME_ZONE, locale = "en-CA"): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat(locale, {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatRelativeTime(instant: Date | string, now: Date = new Date()): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return d.toISOString().slice(0, 10);
}

export const COMMON_TIME_ZONES = [
  "America/Toronto",
  "America/Montreal",
  "America/Halifax",
  "America/St_Johns",
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
  "America/Whitehorse",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "UTC",
] as const;
