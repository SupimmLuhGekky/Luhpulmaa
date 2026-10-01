import type { AccountType } from "@prisma/client";
import { z } from "zod";
import { env } from "@/lib/config/env";
import { addDays, daysBetween, isLocalDate, type LocalDate } from "@/lib/dates";
import { stripAccents } from "@/lib/transactions/normalize";
import { ProviderError, type ExchangeResult, type FinancialDataProvider, type LinkSession, type ProviderAccount, type ProviderTransaction, type TransactionPage, type TransactionQuery } from "../types";

/**
 * Lunch Flow adapter (https://www.lunchflow.app/docs/api/personal-api-overview).
 *
 * Lunch Flow is a personal service: the person connects their bank inside Lunch Flow
 * (it reaches Canadian banks such as Neo Financial through MX or Finicity), creates an
 * API destination there and pastes its key into Harbour. The server needs no keys of
 * its own. The Personal API is read-only: GET /accounts, /accounts/:id/balance and
 * /accounts/:id/transactions, authenticated with an `x-api-key` header.
 *
 * Conventions, from the docs and from what other open-source importers found live:
 *  - amounts are decimals (numbers or strings) signed from the holder's view: purchases
 *    are negative, and a credit card's balance is negative while money is owed;
 *  - accounts carry no type (Harbour asks the person) and often no currency (their
 *    balance has one);
 *  - only posted transactions are imported (the API's default), so a card hold that
 *    settles at a different amount can never become a duplicate;
 *  - a `total` larger than the rows returned means the window was cut short, so the
 *    window is fetched again in halves.
 *
 * What Harbour stores (encrypted) as this connection's "access token" is a small JSON
 * document: the API key, which Lunch Flow bank connection this Harbour connection
 * covers, and the accounts the person chose not to import.
 */

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
/** 180 days halves to under a day in 8 steps. */
const MAX_SPLIT_DEPTH = 8;

export const LUNCH_FLOW_DEFAULT_INSTITUTION = "Lunch Flow";

// ─────────────────────────────────────────────────────────────────────────────
// Stored token
// ─────────────────────────────────────────────────────────────────────────────

export interface LunchFlowToken {
  /** The person's Lunch Flow API key. */
  key: string;
  /** `lunchFlowGroupKey` of the Lunch Flow bank connection this Harbour connection covers. */
  group: string;
  /** Lunch Flow account ids the person chose not to import. */
  skip: string[];
}

const tokenSchema = z.object({ v: z.literal(1), key: z.string().min(1), group: z.string().min(1), skip: z.array(z.string()) });

export function encodeLunchFlowToken(token: LunchFlowToken): string {
  return JSON.stringify({ v: 1, key: token.key, group: token.group, skip: [...new Set(token.skip)].sort() });
}

export function decodeLunchFlowToken(stored: string): LunchFlowToken {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    parsed = null;
  }
  const result = tokenSchema.safeParse(parsed);
  if (!result.success) throw new ProviderError("LOGIN_REQUIRED", "Harbour's Lunch Flow key for this bank is missing. Paste your Lunch Flow API key again.");
  return { key: result.data.key, group: result.data.group, skip: result.data.skip };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shapes (lenient: fields the docs list as present are sometimes missing)
// ─────────────────────────────────────────────────────────────────────────────

const decimal = z.union([z.number(), z.string()]);

const rawAccountSchema = z.object({
  id: z.union([z.string().trim().min(1), z.number().int()]).transform(String),
  connection_id: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish(),
  institution_name: z.string().nullish(),
  currency: z.string().nullish(),
  status: z.string().nullish(),
});
export type LunchFlowRawAccount = z.infer<typeof rawAccountSchema>;

const accountsResponse = z.object({ accounts: z.array(rawAccountSchema) });
const balanceResponse = z.object({ balance: z.object({ amount: decimal, currency: z.string().nullish() }) });
const transactionsResponse = z.object({ transactions: z.array(z.unknown()), total: z.number().nullish() });

const rawTransactionSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  amount: decimal.nullish(),
  currency: z.string().nullish(),
  date: z.union([z.string(), z.number()]).nullish(),
  merchant: z.string().nullish(),
  description: z.string().nullish(),
  isPending: z.union([z.boolean(), z.string()]).nullish(),
});
export type LunchFlowRawTransaction = z.infer<typeof rawTransactionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Pure mapping helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** "-41.17", -41.17 or "12" → integer cents, rounding half away from zero; null if unreadable. */
export function decimalToCents(value: number | string): number | null {
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(2) : "") : value.trim();
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  const digits = `${frac}000`.slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return cents === 0 ? 0 : sign === "-" ? -cents : cents;
}

/** "2026-09-30", "2026-09-30T14:02:11Z" or a Unix time → "2026-09-30"; null if unreadable. */
export function parseLunchFlowDate(value: unknown): LocalDate | null {
  if (typeof value === "string") {
    const day = value.trim().slice(0, 10);
    return isLocalDate(day) ? day : null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000;
    const day = new Date(ms).toISOString().slice(0, 10);
    return isLocalDate(day) ? day : null;
  }
  return null;
}

/** Which Lunch Flow bank connection an account belongs to (one Harbour connection each). */
export function lunchFlowGroupKey(account: Pick<LunchFlowRawAccount, "connection_id" | "institution_name">): string {
  const connection = account.connection_id === null || account.connection_id === undefined ? "" : String(account.connection_id).trim();
  if (connection) return `connection:${connection}`;
  const institution = slug(account.institution_name ?? "");
  return institution ? `institution:${institution}` : "accounts";
}

export function slug(text: string): string {
  return stripAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * Lunch Flow doesn't say what kind of account each one is, so Harbour suggests a type
 * from its name and the person confirms it.
 */
export function guessLunchFlowAccountType(name: string): AccountType {
  const n = stripAccents(name).toLowerCase();
  if (/\b(line of credit|marge de credit|loc|heloc)\b/.test(n)) return "LINE_OF_CREDIT";
  if (/\b(mortgage|hypotheque)\b/.test(n)) return "MORTGAGE";
  if (/\b(loan|pret)\b/.test(n)) return "LOAN";
  if (/\b(credit|visa|mastercard|amex|american express)\b/.test(n) || (/\b(card|carte)\b/.test(n) && !/\bdebit\b/.test(n))) return "CREDIT_CARD";
  if (/\b(tfsa|celi|rrsp|reer|resp|reee|fhsa|celiapp|invest\w*|brokerage|courtage|crypto|portfolio|portefeuille)\b/.test(n)) return "INVESTMENT";
  if (/\b(saving\w*|epargne|hisa|high[- ]interest)\b/.test(n)) return "SAVINGS";
  return "CHEQUING";
}

function isPending(value: LunchFlowRawTransaction["isPending"]): boolean {
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

/** One posted transaction in Harbour's conventions, or null for rows Harbour doesn't import. */
export function mapLunchFlowTransaction(raw: LunchFlowRawTransaction, providerAccountId: string, accountCurrency: string): ProviderTransaction | null {
  if (isPending(raw.isPending)) return null;
  const id = raw.id === null || raw.id === undefined ? "" : String(raw.id).trim();
  const date = parseLunchFlowDate(raw.date);
  const amountCents = raw.amount === null || raw.amount === undefined ? null : decimalToCents(raw.amount);
  // Zero-amount rows (card checks) move no money.
  if (!id || !date || amountCents === null || amountCents === 0) return null;
  const merchant = raw.merchant?.trim() || null;
  return {
    providerTransactionId: id,
    providerAccountId,
    date,
    postedDate: date,
    amountCents,
    currency: raw.currency?.trim().toUpperCase() || accountCurrency,
    description: (raw.description?.trim() || merchant || "Transaction").slice(0, 500),
    merchantName: merchant ? merchant.slice(0, 120) : null,
    pending: false,
  };
}

/** An account Lunch Flow shares through the key, with its balance. */
export interface LunchFlowAccount {
  providerAccountId: string;
  name: string;
  institution: string;
  group: string;
  currency: string;
  /** Signed from the holder's view: negative while a card or loan is owed. */
  balanceCents: number;
  guessedType: AccountType;
  /** False when Lunch Flow reports that its link to the bank needs attention. */
  active: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A transaction row's id, or the whole row when it has none. */
function rowKey(row: unknown): string {
  const id = row !== null && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
  return typeof id === "string" || typeof id === "number" ? `id:${id}` : `row:${JSON.stringify(row)}`;
}

function retryDelayMs(res: Response | null, attempt: number): number {
  const header = res?.headers.get("retry-after");
  const seconds = header && /^\d+$/.test(header.trim()) ? Number(header.trim()) : null;
  // Honour short Retry-After values; anything longer is left to the next scheduled sync.
  if (seconds !== null && seconds <= 10) return seconds * 1000;
  return 1000 * 2 ** (attempt - 1);
}

export class LunchFlowProvider implements FinancialDataProvider {
  readonly id = "LUNCHFLOW" as const;
  readonly displayName = "Lunch Flow";
  readonly isSimulated = false;
  readonly reportsRemovals = false;
  readonly reportsAccountTypes = false;

  /** Each person brings their own API key, so there is nothing to configure on the server. */
  isConfigured() {
    return true;
  }

  private base(): string {
    const e = env();
    const url = e.LUNCHFLOW_API_URL.replace(/\/+$/, "");
    if (e.appEnv === "production" && !url.startsWith("https://")) throw new ProviderError("NOT_CONFIGURED", "Lunch Flow is misconfigured on this server.");
    return url;
  }

  /** GET with a timeout and a couple of retries for busy answers. The key never leaves the configured host. */
  private async get(apiKey: string, path: string): Promise<{ status: number; data: unknown }> {
    for (let attempt = 1; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await fetch(`${this.base()}${path}`, {
          method: "GET",
          headers: { Accept: "application/json", "x-api-key": apiKey },
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(retryDelayMs(null, attempt));
          continue;
        }
        throw new ProviderError("PROVIDER_UNAVAILABLE", "Harbour couldn't reach Lunch Flow. Check your internet connection and try again.", true);
      }
      if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
        await res.body?.cancel().catch(() => undefined);
        await sleep(retryDelayMs(res, attempt));
        continue;
      }
      const data: unknown = await res.json().catch(() => null);
      return { status: res.status, data };
    }
  }

  /** Lunch Flow's own error text is never shown: it could contain anything. */
  private fail(status: number): never {
    if (status === 401 || status === 403) {
      throw new ProviderError("LOGIN_REQUIRED", "Lunch Flow didn't accept the API key. Create a new key in Lunch Flow and paste it into Harbour.");
    }
    if (status === 429) throw new ProviderError("RATE_LIMITED", "Lunch Flow asked Harbour to slow down. Harbour will try again later.", true);
    if (status === 503) throw new ProviderError("INSTITUTION_UNAVAILABLE", "Lunch Flow couldn't get data from your bank just now. Harbour will try again later.", true);
    if (status >= 500) throw new ProviderError("PROVIDER_UNAVAILABLE", "Lunch Flow had a problem answering. Harbour will try again later.", true);
    if (status >= 300 && status < 400) throw new ProviderError("PROVIDER_UNAVAILABLE", "Lunch Flow's address has changed. Update Harbour to keep syncing.");
    throw new ProviderError("INVALID_REQUEST", "Lunch Flow couldn't complete the request.");
  }

  private unexpected(): never {
    throw new ProviderError("UNKNOWN", "Lunch Flow sent data Harbour doesn't understand. Harbour may need an update.");
  }

  async listRawAccounts(apiKey: string): Promise<LunchFlowRawAccount[]> {
    const { status, data } = await this.get(apiKey, "/accounts");
    if (status !== 200) this.fail(status);
    const parsed = accountsResponse.safeParse(data);
    if (!parsed.success) this.unexpected();
    return parsed.data.accounts;
  }

  /** The account's balance, or null when Lunch Flow no longer has the account. */
  private async balance(apiKey: string, accountId: string): Promise<{ cents: number; currency: string | null } | null> {
    const { status, data } = await this.get(apiKey, `/accounts/${encodeURIComponent(accountId)}/balance`);
    if (status === 404) return null;
    if (status !== 200) this.fail(status);
    const parsed = balanceResponse.safeParse(data);
    const cents = parsed.success ? decimalToCents(parsed.data.balance.amount) : null;
    if (!parsed.success || cents === null) this.unexpected();
    return { cents, currency: parsed.data.balance.currency?.trim().toUpperCase() || null };
  }

  /** Accounts with balances. Accounts Lunch Flow no longer has are left out. */
  async withBalances(apiKey: string, accounts: LunchFlowRawAccount[]): Promise<LunchFlowAccount[]> {
    const out: LunchFlowAccount[] = [];
    for (const a of accounts) {
      const balance = await this.balance(apiKey, a.id);
      if (!balance) continue;
      const institution = a.institution_name?.trim() || LUNCH_FLOW_DEFAULT_INSTITUTION;
      const name = a.name?.trim() || `${institution} account`;
      out.push({
        providerAccountId: a.id,
        name: name.slice(0, 60),
        institution,
        group: lunchFlowGroupKey(a),
        currency: a.currency?.trim().toUpperCase() || balance.currency || "CAD",
        balanceCents: balance.cents,
        guessedType: guessLunchFlowAccountType(name),
        active: !a.status || a.status.trim().toUpperCase() === "ACTIVE",
      });
    }
    return out;
  }

  /** Every account the key can read, grouped later by bank connection. Used when connecting. */
  async discover(apiKey: string): Promise<LunchFlowAccount[]> {
    return this.withBalances(apiKey, await this.listRawAccounts(apiKey));
  }

  /** The accounts of the one Lunch Flow bank connection a stored token covers. */
  private async connectionAccounts(token: LunchFlowToken): Promise<LunchFlowAccount[]> {
    const raw = (await this.listRawAccounts(token.key)).filter((a) => lunchFlowGroupKey(a) === token.group);
    if (!raw.length) {
      throw new ProviderError("LOGIN_REQUIRED", "Lunch Flow no longer shares this bank's accounts with Harbour's key. Check the bank in Lunch Flow, then reconnect it in Harbour.");
    }
    if (raw.every((a) => a.status && a.status.trim().toUpperCase() !== "ACTIVE")) {
      const institution = raw[0]?.institution_name?.trim() || "your bank";
      throw new ProviderError("INSTITUTION_UNAVAILABLE", `Lunch Flow has lost its connection to ${institution}. Reconnect it in Lunch Flow, and Harbour will catch up on the next sync.`);
    }
    const skip = new Set(token.skip);
    return this.withBalances(
      token.key,
      raw.filter((a) => !skip.has(a.id)),
    );
  }

  private async transactionsPage(apiKey: string, accountId: string, from: LocalDate, to: LocalDate): Promise<{ rows: unknown[]; total: number | null } | null> {
    const params = new URLSearchParams({ from, to, include_pending: "false" });
    const { status, data } = await this.get(apiKey, `/accounts/${encodeURIComponent(accountId)}/transactions?${params}`);
    if (status === 404) return null;
    if (status !== 200) this.fail(status);
    const parsed = transactionsResponse.safeParse(data);
    if (!parsed.success) this.unexpected();
    return { rows: parsed.data.transactions, total: parsed.data.total ?? null };
  }

  /**
   * Rows for [from, to]. When `total` says rows are missing, the window is fetched again
   * in halves; if the halves hold no row the whole window didn't, `total` wasn't a row
   * limit after all (or the dates were ignored), and splitting stops.
   */
  private async transactionRows(apiKey: string, accountId: string, from: LocalDate, to: LocalDate, first?: { rows: unknown[]; total: number | null }, depth = 0): Promise<unknown[]> {
    const page = first ?? (await this.transactionsPage(apiKey, accountId, from, to));
    if (!page) return [];
    const cutShort = page.total !== null && page.total > page.rows.length;
    if (!cutShort || from >= to || depth >= MAX_SPLIT_DEPTH) return page.rows;
    const mid = addDays(from, Math.floor(daysBetween(from, to) / 2));
    const left = await this.transactionsPage(apiKey, accountId, from, mid);
    const right = await this.transactionsPage(apiKey, accountId, addDays(mid, 1), to);
    const known = new Set(page.rows.map(rowKey));
    if (!left || !right || ![...left.rows, ...right.rows].some((r) => !known.has(rowKey(r)))) return page.rows;
    return [
      ...(await this.transactionRows(apiKey, accountId, from, mid, left, depth + 1)),
      ...(await this.transactionRows(apiKey, accountId, addDays(mid, 1), to, right, depth + 1)),
    ];
  }

  async createLinkSession(): Promise<LinkSession> {
    throw new ProviderError("INVALID_REQUEST", "Lunch Flow is connected by pasting an API key from your Lunch Flow account.");
  }

  async exchangePublicToken(): Promise<ExchangeResult> {
    throw new ProviderError("INVALID_REQUEST", "Lunch Flow is connected by pasting an API key from your Lunch Flow account.");
  }

  async getAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const accounts = await this.connectionAccounts(decodeLunchFlowToken(accessToken));
    return accounts.map((a) => ({
      providerAccountId: a.providerAccountId,
      name: a.name,
      officialName: a.name,
      mask: null,
      type: a.guessedType,
      currency: a.currency,
      currentBalanceCents: a.balanceCents,
      availableBalanceCents: null,
      creditLimitCents: null,
    }));
  }

  async getBalances(accessToken: string): Promise<ProviderAccount[]> {
    return this.getAccounts(accessToken);
  }

  async getTransactions(accessToken: string, query: TransactionQuery): Promise<TransactionPage> {
    const token = decodeLunchFlowToken(accessToken);
    const accounts = await this.connectionAccounts(token);
    const added: ProviderTransaction[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const account of accounts) {
      const rows = await this.transactionRows(token.key, account.providerAccountId, query.startDate, query.endDate);
      for (const row of rows) {
        const parsed = rawTransactionSchema.safeParse(row);
        const tx = parsed.success ? mapLunchFlowTransaction(parsed.data, account.providerAccountId, account.currency) : null;
        if (!tx) {
          skipped++;
          continue;
        }
        const key = `${tx.providerAccountId}|${tx.providerTransactionId}`;
        if (seen.has(key) || tx.date < query.startDate || tx.date > query.endDate) continue;
        seen.add(key);
        added.push(tx);
      }
    }
    // Counts only: rows can hold personal data, so none of it is logged.
    if (skipped) console.info(`[lunchflow] skipped ${skipped} pending, zero or unreadable row(s)`);
    return { added, modified: [], removed: [], nextCursor: null, hasMore: false };
  }

  /** Lunch Flow keys are revoked in Lunch Flow itself; Harbour just deletes its copy. */
  async disconnectAccount(): Promise<void> {}
}
