/**
 * Financial-data provider abstraction.
 *
 * The rest of the application only ever talks to `FinancialDataProvider`. Provider
 * SDK/HTTP details, field names and sign conventions stay inside each adapter in
 * ./providers. Adapters return data already normalised to our conventions:
 *  - amounts in integer cents
 *  - transaction amounts signed from the account holder's view (negative = outflow)
 *  - liability balances as positive amounts owed
 *  - dates as "YYYY-MM-DD"
 *
 * Bank credentials never pass through this application: users authenticate with
 * their institution inside the provider's own hosted flow (Plaid Link, Flinks
 * Connect). We only receive and store (encrypted) the provider's access token.
 */
import type { AccountType, ProviderType } from "@prisma/client";
import type { LocalDate } from "@/lib/dates";

export interface LinkSession {
  provider: ProviderType;
  /** How the client should launch the flow. */
  mode: "mock" | "plaid_link" | "iframe";
  /** Plaid link_token / mock session id. */
  linkToken?: string;
  /** Iframe/redirect URL for widget-based providers (Flinks Connect). */
  url?: string;
  expiresAt: string;
}

export interface InstitutionInfo {
  providerInstitutionId: string;
  name: string;
  country?: string;
  primaryColor?: string | null;
  logoUrl?: string | null;
}

export interface ExchangeResult {
  /** Stable id of the connection at the provider (Plaid item_id, Flinks LoginId…). */
  providerItemId: string;
  /** Secret used for subsequent API calls. Encrypted before storage; never logged. */
  accessToken: string;
  institution: InstitutionInfo;
}

export interface ProviderAccount {
  providerAccountId: string;
  name: string;
  officialName?: string | null;
  mask?: string | null;
  type: AccountType;
  currency: string;
  currentBalanceCents: number;
  availableBalanceCents?: number | null;
  creditLimitCents?: number | null;
}

export interface ProviderTransaction {
  providerTransactionId: string;
  providerAccountId: string;
  /** Provider id of the pending transaction this posted one replaces. */
  pendingTransactionId?: string | null;
  date: LocalDate;
  postedDate?: LocalDate | null;
  amountCents: number;
  currency: string;
  description: string;
  merchantName?: string | null;
  pending: boolean;
  /** Our category systemKey when the provider's own category maps cleanly (optional). */
  categoryHint?: string | null;
}

export interface TransactionPage {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  /** Provider transaction ids that no longer exist (e.g. expired pending). */
  removed: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TransactionQuery {
  /** Incremental cursor returned by the previous page/sync, if the provider supports it. */
  cursor?: string | null;
  /** Date window for range-based providers. */
  startDate: LocalDate;
  endDate: LocalDate;
}

export interface FinancialDataProvider {
  readonly id: ProviderType;
  readonly displayName: string;
  /** True when the provider operates on simulated data (never real money). */
  readonly isSimulated: boolean;
  isConfigured(): boolean;
  createLinkSession(userId: string, opts?: { reconnectItemId?: string; accessToken?: string }): Promise<LinkSession>;
  exchangePublicToken(userId: string, publicToken: string, metadata?: Record<string, unknown>): Promise<ExchangeResult>;
  getAccounts(accessToken: string): Promise<ProviderAccount[]>;
  /** Fresh balances (may trigger a live refresh at the institution). */
  getBalances(accessToken: string): Promise<ProviderAccount[]>;
  getTransactions(accessToken: string, query: TransactionQuery): Promise<TransactionPage>;
  disconnectAccount(accessToken: string): Promise<void>;
}

export type ProviderErrorCode =
  | "NOT_CONFIGURED"
  | "LOGIN_REQUIRED"
  | "INSTITUTION_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "UNKNOWN";

/** Errors raised by adapters. `message` is user-safe; provider payloads are never included. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
