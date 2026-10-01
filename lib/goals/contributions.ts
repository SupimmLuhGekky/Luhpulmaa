/**
 * Planned allocations vs actual transfers. Pure helpers shared by the goal pages,
 * the goals API and their tests.
 *
 * - PLANNED_ALLOCATION: an earmark from a plan, an automation or the user. No money moved.
 * - USER_REPORTED_TRANSFER: the user says the money actually moved (optionally linked to
 *   the bank transaction that shows it).
 * - PROVIDER_TRANSFER: a verified transfer by a regulated partner (never created in v1),
 *   which also counts as actual money.
 */
import { addDays, type LocalDate } from "@/lib/dates";
import type { Cents } from "@/lib/finance/money";

export type ContributionKindName = "PLANNED_ALLOCATION" | "USER_REPORTED_TRANSFER" | "PROVIDER_TRANSFER";

export function isActualKind(kind: ContributionKindName): boolean {
  return kind !== "PLANNED_ALLOCATION";
}

export interface KindTotals {
  /** Money earmarked by plans, automations or the user — nothing moved. */
  planned: Cents;
  /** Money the user reports actually moving, or linked bank transfers. */
  actual: Cents;
  total: Cents;
}

export function totalsByKind(contributions: { amount: Cents; kind: ContributionKindName }[]): KindTotals {
  let planned = 0;
  let actual = 0;
  for (const c of contributions) {
    if (isActualKind(c.kind)) actual += c.amount;
    else planned += c.amount;
  }
  return { planned, actual, total: planned + actual };
}

export interface GrowthPoint {
  date: LocalDate;
  /** Running totals at the end of `date`. */
  actual: Cents;
  planned: Cents;
  total: Cents;
}

/**
 * Running planned/actual totals, one point per day that had contributions, oldest
 * first. With `startAt` the series opens at zero on the day before the first
 * contribution (or on `startAt` if that is earlier); with `extendTo` it is carried
 * flat to that day so a chart reaches "today".
 */
export function growthSeries(
  contributions: { date: LocalDate; amount: Cents; kind: ContributionKindName }[],
  opts: { startAt?: LocalDate | null; extendTo?: LocalDate | null } = {},
): GrowthPoint[] {
  const sorted = [...contributions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points: GrowthPoint[] = [];
  let actual = 0;
  let planned = 0;
  for (const c of sorted) {
    if (isActualKind(c.kind)) actual += c.amount;
    else planned += c.amount;
    const last = points[points.length - 1];
    if (last && last.date === c.date) {
      last.actual = actual;
      last.planned = planned;
      last.total = actual + planned;
    } else {
      points.push({ date: c.date, actual, planned, total: actual + planned });
    }
  }
  if (opts.startAt !== undefined && opts.startAt !== null) {
    const first = points[0]?.date;
    const zeroDay = first ? (opts.startAt < first ? opts.startAt : addDays(first, -1)) : opts.startAt;
    points.unshift({ date: zeroDay, actual: 0, planned: 0, total: 0 });
  }
  const last = points[points.length - 1];
  if (opts.extendTo && last && last.date < opts.extendTo) {
    points.push({ ...last, date: opts.extendTo });
  }
  return points;
}
