/**
 * Net-worth breakdown helpers (pure: safe for unit tests and client components).
 */
import { addMonths, startOfYear, type LocalDate } from "@/lib/dates";
import { ratioBps, type Bps, type Cents } from "@/lib/finance/money";

export const NET_WORTH_RANGES = ["1m", "3m", "6m", "ytd", "1y", "all"] as const;
export type NetWorthRange = (typeof NET_WORTH_RANGES)[number];

export const NET_WORTH_RANGE_LABELS: Record<NetWorthRange, string> = { "1m": "1M", "3m": "3M", "6m": "6M", ytd: "YTD", "1y": "1Y", all: "All" };

export function parseNetWorthRange(value: unknown, fallback: NetWorthRange = "6m"): NetWorthRange {
  return typeof value === "string" && (NET_WORTH_RANGES as readonly string[]).includes(value) ? (value as NetWorthRange) : fallback;
}

/** First day of a history range (null = from the earliest snapshot). */
export function netWorthRangeStart(range: NetWorthRange, today: LocalDate): LocalDate | null {
  switch (range) {
    case "1m":
      return addMonths(today, -1);
    case "3m":
      return addMonths(today, -3);
    case "6m":
      return addMonths(today, -6);
    case "ytd":
      return startOfYear(today);
    case "1y":
      return addMonths(today, -12);
    default:
      return null;
  }
}

export type NetWorthGroupKey = "cash" | "investments" | "otherAssets" | "creditCards" | "loans" | "otherLiabilities";

export const NET_WORTH_GROUPS: { key: NetWorthGroupKey; label: string; side: "asset" | "liability" }[] = [
  { key: "cash", label: "Cash", side: "asset" },
  { key: "investments", label: "Investments", side: "asset" },
  { key: "otherAssets", label: "Other assets", side: "asset" },
  { key: "creditCards", label: "Credit cards", side: "liability" },
  { key: "loans", label: "Loans", side: "liability" },
  { key: "otherLiabilities", label: "Other debts", side: "liability" },
];

export interface AccountBalanceInput {
  id: string;
  name: string;
  type: string;
  group: NetWorthGroupKey;
  side: "asset" | "liability";
  /** Converted to the user's currency. Assets: amount held. Liabilities: amount owed (positive). */
  balance: Cents;
  /** Balance at the start of the range (same convention), or null without history then. */
  startBalance: Cents | null;
  included: boolean;
  institution: string | null;
  isManual: boolean;
  isSimulated: boolean;
  isHidden: boolean;
}

export interface AccountContribution extends AccountBalanceInput {
  /** Signed effect on net worth: + for assets, − for liabilities. */
  contribution: Cents;
  /** Signed change of that effect since the range start (null without a starting balance). */
  change: Cents | null;
  /** Share of its side (assets or liabilities). */
  shareBps: Bps;
}

/**
 * Splits accounts into included/excluded, signs each account's contribution to net
 * worth, its change since the range start, and its share of assets or liabilities,
 * then groups them like the net-worth breakdown.
 */
export function accountContributions(rows: AccountBalanceInput[]) {
  const included = rows.filter((r) => r.included);
  const assets = included.filter((r) => r.side === "asset").reduce((a, r) => a + r.balance, 0);
  const liabilities = included.filter((r) => r.side === "liability").reduce((a, r) => a + r.balance, 0);
  const sign = (r: AccountBalanceInput) => (r.side === "asset" ? 1 : -1);
  const accounts: AccountContribution[] = included.map((r) => ({
    ...r,
    contribution: sign(r) * r.balance,
    change: r.startBalance === null ? null : sign(r) * (r.balance - r.startBalance),
    shareBps: ratioBps(r.balance, r.side === "asset" ? assets : liabilities),
  }));
  const groups = NET_WORTH_GROUPS.map((g) => {
    const list = accounts.filter((a) => a.group === g.key).sort((a, b) => b.balance - a.balance);
    const total = list.reduce((acc, a) => acc + a.balance, 0);
    const known = list.filter((a) => a.change !== null);
    return {
      ...g,
      total,
      shareBps: ratioBps(total, g.side === "asset" ? assets : liabilities),
      change: known.length ? known.reduce((acc, a) => acc + (a.change ?? 0), 0) : null,
      accounts: list,
    };
  }).filter((g) => g.accounts.length > 0);
  return {
    assets,
    liabilities,
    netWorth: assets - liabilities,
    groups,
    excluded: rows.filter((r) => !r.included),
  };
}

export type NetWorthAccounts = ReturnType<typeof accountContributions>;
