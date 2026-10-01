import { centsToDecimalString, parseMoney } from "@/lib/finance/money";
import { transactionFiltersSchema, type TransactionFilters } from "./schemas";

/**
 * The transactions page keeps its filters in the URL so views can be bookmarked and
 * linked to (the dashboard links to `?category=…` and `?txn=…`). Short, readable
 * parameter names map onto the service's filter schema; amounts are in dollars.
 */
export const FILTER_PARAMS = {
  q: "q",
  accountId: "account",
  categoryId: "category",
  type: "type",
  tagId: "tag",
  from: "from",
  to: "to",
  minCents: "min",
  maxCents: "max",
  pending: "pending",
  review: "review",
  sort: "sort",
  page: "page",
} as const satisfies Partial<Record<keyof TransactionFilters, string>>;

/** Longer spellings some links use (search results, notifications, the API). */
const ALIASES: Partial<Record<keyof typeof FILTER_PARAMS, string>> = { accountId: "accountId", categoryId: "categoryId", tagId: "tagId" };

/** `?txn=<id>` opens that transaction's details. */
export const TXN_PARAM = "txn";

type FilterKey = keyof typeof FILTER_PARAMS;
type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(sp: SearchParams, name: string): string | undefined {
  const v = sp instanceof URLSearchParams ? (sp.get(name) ?? undefined) : sp[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === "" ? undefined : s;
}

/** Parses each parameter on its own so one bad value never discards the others. */
export function filtersFromSearchParams(sp: SearchParams): TransactionFilters {
  const shape = transactionFiltersSchema.shape;
  const out: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(FILTER_PARAMS) as [FilterKey, string][]) {
    let raw: unknown = read(sp, param) ?? (ALIASES[key] ? read(sp, ALIASES[key]) : undefined);
    if (raw === undefined) continue;
    if (key === "minCents" || key === "maxCents") raw = parseMoney(String(raw)) ?? undefined;
    if (raw === undefined) continue;
    const parsed = shape[key].safeParse(raw);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return transactionFiltersSchema.parse(out);
}

/** The transaction whose details should open, if the URL names a valid one. */
export function txnFromSearchParams(sp: SearchParams): string | null {
  const v = read(sp, TXN_PARAM);
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

const RENAMES: Record<string, string> = { accountId: FILTER_PARAMS.accountId, categoryId: FILTER_PARAMS.categoryId, tagId: FILTER_PARAMS.tagId, id: TXN_PARAM };

/**
 * The page's own query string for a URL that uses longer or older spellings
 * (`?categoryId=`, `?id=`), or null when it already uses the current ones. The page
 * redirects to it so the filters the user then changes are the ones in the URL.
 */
export function canonicalQuery(sp: Record<string, string | string[] | undefined>): string | null {
  if (!Object.keys(RENAMES).some((k) => sp[k] !== undefined)) return null;
  const out = new URLSearchParams();
  for (const [key, raw] of Object.entries(sp)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined) continue;
    const name = RENAMES[key] ?? key;
    if (RENAMES[key] && sp[name] !== undefined) continue; // the current spelling wins
    out.set(name, value);
  }
  return out.toString();
}

/** Inverse of `filtersFromSearchParams` for the values the UI sets. */
export function filterParamValue(key: FilterKey, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (key === "minCents" || key === "maxCents") return centsToDecimalString(Number(value));
  return String(value);
}

/** Number of narrowing filters in effect (search, sort and page don't count). */
export function activeFilterCount(f: TransactionFilters): number {
  return [f.accountId, f.categoryId, f.type, f.tagId, f.from || f.to, f.minCents !== undefined || f.maxCents !== undefined, f.pending, f.review].filter(Boolean).length;
}
