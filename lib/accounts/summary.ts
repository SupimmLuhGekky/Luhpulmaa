/**
 * Pure, client-safe helpers for the accounts pages: grouping and subtotals, credit
 * utilization, balance-history series and "last synced" labels. No database access;
 * every amount is integer cents straight from the services.
 */
import type { AccountType } from "@prisma/client";
import { addDays, addMonths, type LocalDate } from "@/lib/dates";
import { ratioBps } from "@/lib/finance/money";
import { ACCOUNT_GROUPS, hasCreditLimit, isLiability, type AccountGroup } from "./types";

export interface GroupableAccount {
  type: AccountType;
  currency: string;
  currentBalanceCents: number;
  isHidden: boolean;
  institution?: { id: string } | null;
}

export interface AccountGroupView<T> {
  key: AccountGroup;
  label: string;
  accounts: T[];
  /** "asset" when every account in the group is an asset, "liability" when every one is a debt. */
  kind: "asset" | "liability" | "mixed";
  /**
   * Subtotal per currency (the user's currency first). Asset groups: amount held.
   * Debt groups: amount owed (positive). Mixed groups: assets minus debts.
   */
  totals: { currency: string; cents: number }[];
}

/**
 * Groups accounts in display order (cash, credit, loans, investments, other), dropping
 * empty groups. Inside a group, accounts at the same institution stay together, in the
 * order the institutions first appear; otherwise the incoming order is kept.
 */
export function groupAccounts<T extends GroupableAccount>(accounts: T[], opts: { includeHidden?: boolean; baseCurrency?: string } = {}): AccountGroupView<T>[] {
  const visible = opts.includeHidden ? accounts : accounts.filter((a) => !a.isHidden);
  const rank = new Map<string, number>();
  const rankOf = (a: T, i: number) => {
    const key = a.institution?.id ?? `#${i}`;
    if (!rank.has(key)) rank.set(key, rank.size);
    return rank.get(key)!;
  };
  const ordered = visible
    .map((a, i) => ({ a, i, r: rankOf(a, i) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a);
  const groups: AccountGroupView<T>[] = [];
  for (const g of ACCOUNT_GROUPS) {
    const members = ordered.filter((a) => g.types.includes(a.type));
    if (!members.length) continue;
    const debts = members.filter((a) => isLiability(a.type)).length;
    const kind = debts === 0 ? "asset" : debts === members.length ? "liability" : "mixed";
    const byCurrency = new Map<string, number>();
    for (const a of members) {
      const signed = kind === "mixed" && isLiability(a.type) ? -a.currentBalanceCents : a.currentBalanceCents;
      byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + signed);
    }
    const totals = [...byCurrency.entries()]
      .map(([currency, cents]) => ({ currency, cents }))
      .sort((x, y) => (x.currency === opts.baseCurrency ? -1 : y.currency === opts.baseCurrency ? 1 : x.currency.localeCompare(y.currency)));
    groups.push({ key: g.key, label: g.label, accounts: members, kind, totals });
  }
  return groups;
}

export type UtilizationTone = "primary" | "warning" | "danger";

/** Under 30% is comfortable; 75% and above is close to the limit. */
export function utilizationTone(usedBps: number): UtilizationTone {
  if (usedBps >= 7500) return "danger";
  if (usedBps >= 3000) return "warning";
  return "primary";
}

export interface CreditUtilization {
  limit: number;
  /** Amount owed counted against the limit (a credit balance counts as 0). */
  used: number;
  /** Credit still available (limit minus balance owed). */
  available: number;
  /** Share of the limit used, in basis points (can exceed 10000 when over the limit). */
  usedBps: number;
  tone: UtilizationTone;
}

/** Utilization of a credit card or line of credit with a known limit; null otherwise. */
export function creditUtilization(a: { type: AccountType; currentBalanceCents: number; creditLimitCents: number | null }): CreditUtilization | null {
  if (!hasCreditLimit(a.type) || !a.creditLimitCents || a.creditLimitCents <= 0) return null;
  const used = Math.max(0, a.currentBalanceCents);
  const usedBps = ratioBps(used, a.creditLimitCents);
  return { limit: a.creditLimitCents, used, available: a.creditLimitCents - a.currentBalanceCents, usedBps, tone: utilizationTone(usedBps) };
}

export interface BalancePoint {
  date: LocalDate;
  balance: number;
}

/**
 * One point per day from `from` to `to`, carrying each snapshot forward until the
 * next one (balances only change on days with a snapshot). Starts at the first
 * snapshot when history begins after `from`; snapshots after `to` are ignored.
 */
export function dailyBalanceSeries(history: BalancePoint[], from: LocalDate, to: LocalDate): BalancePoint[] {
  const sorted = history.filter((p) => p.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length || from > to) return [];
  let i = 0;
  let current: number | null = null;
  while (i < sorted.length && sorted[i].date <= from) {
    current = sorted[i].balance;
    i++;
  }
  const start = current === null ? sorted[0].date : from;
  const out: BalancePoint[] = [];
  for (let d = start; d <= to; d = addDays(d, 1)) {
    while (i < sorted.length && sorted[i].date <= d) {
      current = sorted[i].balance;
      i++;
    }
    out.push({ date: d, balance: current as number });
  }
  return out;
}

export const HISTORY_RANGES = [
  { key: "1m", label: "1M", months: 1, description: "1 month" },
  { key: "3m", label: "3M", months: 3, description: "3 months" },
  { key: "6m", label: "6M", months: 6, description: "6 months" },
  { key: "1y", label: "1Y", months: 12, description: "12 months" },
] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number]["key"];

export function historyRangeStart(today: LocalDate, range: HistoryRange): LocalDate {
  const r = HISTORY_RANGES.find((x) => x.key === range) ?? HISTORY_RANGES[1];
  return addMonths(today, -r.months);
}

/**
 * "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago"; null when
 * the instant is more than 30 days old (callers show a date instead). UI strings are English.
 */
export function relativeTimeAgo(iso: string, nowIso: string): string | null {
  const seconds = Math.round((new Date(nowIso).getTime() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en-CA", { numeric: "auto" });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days <= 30) return rtf.format(-days, "day");
  return null;
}

export interface ConnectionState {
  label: string;
  tone: "positive" | "warning" | "danger" | "neutral";
  /** A manual "Sync now" can help (it can't while the bank needs a new sign-in). */
  canSync: boolean;
  /** The person has to go through the bank sign-in again. */
  needsReconnect: boolean;
}

/** How a provider connection's status is presented and which actions make sense. */
export function connectionState(status: string): ConnectionState {
  switch (status) {
    case "ACTIVE":
      return { label: "Connected", tone: "positive", canSync: true, needsReconnect: false };
    case "REQUIRES_REAUTH":
      return { label: "Sign-in needed", tone: "warning", canSync: false, needsReconnect: true };
    case "ERROR":
      return { label: "Sync error", tone: "danger", canSync: true, needsReconnect: true };
    case "DISCONNECTED":
      return { label: "Disconnected", tone: "neutral", canSync: false, needsReconnect: true };
    default:
      return { label: "Unknown", tone: "neutral", canSync: false, needsReconnect: false };
  }
}

/**
 * At most `max` evenly spaced points, always keeping the first and the last (today),
 * so long chart ranges stay light without shifting the endpoints.
 */
export function downsample<T>(points: T[], max: number): T[] {
  if (max < 2 || points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}
