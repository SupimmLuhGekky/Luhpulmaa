/**
 * Recurring-series detection (pure).
 *
 * Groups transactions by normalised merchant and direction, then looks for a stable
 * interval. A series needs at least 3 occurrences (2 for monthly+ cadences seen twice
 * with an identical amount), a dominant interval matching a known frequency, and
 * reasonably consistent amounts. Confidence (0–100) combines interval regularity,
 * amount stability and the number of occurrences.
 */
import type { Frequency } from "@prisma/client";
import { addDays, addMonths, daysBetween, type LocalDate } from "@/lib/dates";
import { medianCents } from "@/lib/finance/calculations";
import { normalizeMerchant } from "@/lib/transactions/normalize";
import { matchSystemRule } from "@/lib/transactions/system-rules";

export interface RecurringInputTxn {
  id: string;
  date: LocalDate;
  amountCents: number;
  merchantName: string | null;
  description: string;
  accountId: string;
  categoryId: string | null;
  isTransfer: boolean;
}

export interface DetectedSeries {
  seriesKey: string;
  name: string;
  direction: "INFLOW" | "OUTFLOW";
  frequency: Frequency;
  averageAmountCents: number;
  lastAmountCents: number;
  lastDate: LocalDate;
  nextExpectedDate: LocalDate;
  occurrenceCount: number;
  confidence: number;
  transactionIds: string[];
  accountId: string;
  categoryId: string | null;
  isSubscriptionLike: boolean;
  /** For SEMI_MONTHLY series, the observed pay days. */
  semiMonthlyDays?: number[];
}

interface FrequencyBand {
  frequency: Frequency;
  min: number;
  max: number;
}

const BANDS: FrequencyBand[] = [
  { frequency: "WEEKLY", min: 6, max: 8 },
  { frequency: "BIWEEKLY", min: 12, max: 16 },
  { frequency: "SEMI_MONTHLY", min: 13, max: 18 },
  { frequency: "MONTHLY", min: 26, max: 35 },
  { frequency: "QUARTERLY", min: 85, max: 97 },
  { frequency: "YEARLY", min: 350, max: 380 },
];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Semi-monthly pay (15th & last day) shows alternating 13–18 day gaps anchored to fixed days of month. */
function looksSemiMonthly(dates: LocalDate[]): number[] | null {
  if (dates.length < 4) return null;
  const days = dates.map((d) => Number(d.slice(8, 10)));
  const early = days.filter((d) => d <= 16);
  const late = days.filter((d) => d > 16);
  if (early.length < 2 || late.length < 2) return null;
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  if (spread(early) > 3 || spread(late) > 4) return null;
  const earlyDay = Math.round(median(early));
  const lateDay = late.some((d) => d >= 28) ? 31 : Math.round(median(late));
  return [earlyDay, lateDay];
}

export function classifyFrequency(dates: LocalDate[]): { frequency: Frequency; regularity: number; semiMonthlyDays?: number[] } | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort();
  const gaps = sorted.slice(1).map((d, i) => daysBetween(sorted[i], d)).filter((g) => g > 0);
  if (!gaps.length) return null;
  const med = median(gaps);
  const semi = looksSemiMonthly(sorted);
  if (semi && med >= 13 && med <= 18) {
    const inBand = gaps.filter((g) => g >= 10 && g <= 20).length / gaps.length;
    return { frequency: "SEMI_MONTHLY", regularity: inBand, semiMonthlyDays: semi };
  }
  const band = BANDS.find((b) => b.frequency !== "SEMI_MONTHLY" && med >= b.min && med <= b.max);
  if (!band) return null;
  const regularity = gaps.filter((g) => g >= band.min && g <= band.max).length / gaps.length;
  return { frequency: band.frequency, regularity };
}

export function projectNext(last: LocalDate, frequency: Frequency, semiMonthlyDays?: number[]): LocalDate {
  switch (frequency) {
    case "WEEKLY":
      return addDays(last, 7);
    case "BIWEEKLY":
      return addDays(last, 14);
    case "SEMI_MONTHLY": {
      const [a, b] = semiMonthlyDays ?? [15, 31];
      const day = Number(last.slice(8, 10));
      if (day < a) return addMonths(`${last.slice(0, 7)}-01`, 0, a);
      if (day < Math.min(b, 28)) return addMonths(`${last.slice(0, 7)}-01`, 0, b);
      return addMonths(`${last.slice(0, 7)}-01`, 1, a);
    }
    case "MONTHLY":
      return addMonths(last, 1);
    case "QUARTERLY":
      return addMonths(last, 3);
    case "YEARLY":
      return addMonths(last, 12);
    default:
      return addDays(last, 30);
  }
}

function amountStability(amounts: number[]): number {
  const med = medianCents(amounts.map(Math.abs));
  if (med === 0) return 0;
  const within = amounts.filter((a) => Math.abs(Math.abs(a) - med) * 100 <= med * 15).length;
  return within / amounts.length;
}

/**
 * Whether a series is treated as a subscription. Detection decides once, when the
 * series is first seen; after that the stored flag wins, because the user may have
 * marked it ("Mark as subscription") or unmarked it ("Not a subscription").
 */
export function keepSubscriptionChoice(existing: { isSubscription: boolean } | null | undefined, detected: boolean): boolean {
  return existing ? existing.isSubscription : detected;
}

/** Fields a sync writes to an existing income source (dates as LocalDate). */
export interface IncomeSourceSyncData {
  lastPaidDate: LocalDate;
  averageAmountCents?: number;
  nextExpectedDate?: LocalDate;
  accountId?: string;
  frequency?: Frequency;
  semiMonthlyDays?: number[];
}

/**
 * What a sync may write to an existing income source. Once the user has edited a
 * source on the income page (saving it clears `isDetected`), its amount, next payday,
 * frequency and deposit account are theirs and are never replaced; detection only
 * records when pay last arrived, which keeps the payday schedule and notifications
 * current. Sources Harbour created and the user never edited follow the latest
 * detection.
 */
export function incomeSourceSyncData(existing: { isDetected: boolean }, s: Pick<DetectedSeries, "lastDate" | "averageAmountCents" | "nextExpectedDate" | "accountId" | "frequency" | "semiMonthlyDays">): IncomeSourceSyncData {
  const observed = { lastPaidDate: s.lastDate };
  if (!existing.isDetected) return observed;
  return {
    ...observed,
    averageAmountCents: s.averageAmountCents,
    nextExpectedDate: s.nextExpectedDate,
    accountId: s.accountId,
    frequency: s.frequency,
    ...(s.semiMonthlyDays ? { semiMonthlyDays: s.semiMonthlyDays } : {}),
  };
}

export function detectRecurring(txns: RecurringInputTxn[], today: LocalDate, opts: { minConfidence?: number } = {}): DetectedSeries[] {
  const minConfidence = opts.minConfidence ?? 60;
  const groups = new Map<string, RecurringInputTxn[]>();
  for (const t of txns) {
    if (t.isTransfer || t.amountCents === 0) continue;
    const key = normalizeMerchant(t.merchantName || t.description);
    if (!key) continue;
    const dir = t.amountCents > 0 ? "INFLOW" : "OUTFLOW";
    const k = `${dir}|${key}`;
    const list = groups.get(k) ?? [];
    list.push(t);
    groups.set(k, list);
  }

  const out: DetectedSeries[] = [];
  for (const [k, list] of groups) {
    const [direction, seriesKey] = k.split("|") as ["INFLOW" | "OUTFLOW", string];
    // Collapse same-day duplicates (e.g. split payments) into one occurrence.
    const byDate = new Map<LocalDate, RecurringInputTxn[]>();
    for (const t of list) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
    const dates = [...byDate.keys()].sort();
    const amounts = dates.map((d) => byDate.get(d)!.reduce((a, t) => a + t.amountCents, 0));
    const stability = amountStability(amounts);
    const minOccurrences = 3;
    const allowTwo = dates.length === 2 && stability === 1;
    if (dates.length < minOccurrences && !allowTwo) continue;

    const cls = classifyFrequency(dates);
    if (!cls) continue;
    if (allowTwo && !["MONTHLY", "QUARTERLY", "YEARLY"].includes(cls.frequency)) continue;
    // High-frequency groceries/coffee shops are not "recurring bills": require stable amounts
    // for weekly series and regular intervals for everything.
    if (cls.regularity < 0.6) continue;
    if (cls.frequency === "WEEKLY" && stability < 0.8) continue;

    const last = dates[dates.length - 1];
    let next = projectNext(last, cls.frequency, cls.semiMonthlyDays);
    // A series that stopped (missed 2+ cycles) is no longer active.
    const cycle = cls.frequency === "SEMI_MONTHLY" ? 16 : ({ WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 31, QUARTERLY: 92, YEARLY: 366 } as Record<string, number>)[cls.frequency] ?? 31;
    if (daysBetween(last, today) > cycle * 2 + 5) continue;
    while (next < today) next = projectNext(next, cls.frequency, cls.semiMonthlyDays);

    const countScore = Math.min(1, dates.length / 6);
    const confidence = Math.round((cls.regularity * 0.45 + stability * 0.35 + countScore * 0.2) * 100);
    if (confidence < minConfidence) continue;

    const recent = list.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const sys = matchSystemRule(seriesKey);
    const avg = medianCents(amounts);
    out.push({
      seriesKey,
      name: recent.merchantName || recent.description,
      direction,
      frequency: cls.frequency,
      averageAmountCents: avg,
      lastAmountCents: amounts[amounts.length - 1],
      lastDate: last,
      nextExpectedDate: next,
      occurrenceCount: dates.length,
      confidence,
      transactionIds: list.map((t) => t.id),
      accountId: recent.accountId,
      categoryId: recent.categoryId,
      isSubscriptionLike: direction === "OUTFLOW" && (Boolean(sys?.subscription) || (stability === 1 && Math.abs(avg) <= 10_000 && ["MONTHLY", "YEARLY"].includes(cls.frequency))),
      semiMonthlyDays: cls.semiMonthlyDays,
    });
  }
  return out.sort((a, b) => (a.nextExpectedDate < b.nextExpectedDate ? -1 : 1));
}
