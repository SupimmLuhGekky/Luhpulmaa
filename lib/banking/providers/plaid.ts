import type { AccountType } from "@prisma/client";
import { env } from "@/lib/config/env";
import { ProviderError, type ExchangeResult, type FinancialDataProvider, type LinkSession, type ProviderAccount, type ProviderTransaction, type TransactionPage, type TransactionQuery } from "../types";

/**
 * Plaid adapter (https://plaid.com/docs/api/). Supports Canadian institutions with
 * country_codes ["CA"]. Uses the /transactions/sync cursor API, so sync is incremental.
 *
 * Plaid conventions translated here:
 *  - Plaid amounts are positive for money LEAVING the account → we negate.
 *  - Credit balances are positive amounts owed → matches our liability convention.
 *  - Amounts are decimals → converted to cents via string math.
 */
const BASE_URLS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
} as const;

function toCents(amount: number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  // Plaid returns at most 2 decimals; round via fixed string to avoid FP artefacts.
  const [whole, frac = ""] = Math.abs(amount).toFixed(2).split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return amount < 0 ? -cents : cents;
}

function mapType(type: string, subtype: string | null): AccountType {
  if (type === "credit") return subtype === "line of credit" ? "LINE_OF_CREDIT" : "CREDIT_CARD";
  if (type === "loan") return subtype === "mortgage" ? "MORTGAGE" : "LOAN";
  if (type === "investment" || type === "brokerage") return "INVESTMENT";
  if (type === "depository") return subtype === "savings" || subtype === "cd" || subtype === "money market" ? "SAVINGS" : "CHEQUING";
  return "OTHER_ASSET";
}

/** Maps Plaid personal_finance_category.primary to our category system keys. */
const PFC_MAP: Record<string, string> = {
  INCOME: "income",
  TRANSFER_IN: "transfers",
  TRANSFER_OUT: "transfers",
  LOAN_PAYMENTS: "transfers",
  BANK_FEES: "fees",
  ENTERTAINMENT: "entertainment",
  FOOD_AND_DRINK: "restaurants",
  GENERAL_MERCHANDISE: "shopping",
  HOME_IMPROVEMENT: "housing",
  MEDICAL: "healthcare",
  PERSONAL_CARE: "personal",
  GENERAL_SERVICES: "other",
  GOVERNMENT_AND_NON_PROFIT: "personal",
  TRANSPORTATION: "transportation",
  TRAVEL: "travel",
  RENT_AND_UTILITIES: "utilities",
};

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; available: number | null; limit: number | null; iso_currency_code: string | null };
}

interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  pending_transaction_id: string | null;
  date: string;
  authorized_date: string | null;
  amount: number;
  iso_currency_code: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  personal_finance_category?: { primary: string; detailed: string } | null;
}

export class PlaidProvider implements FinancialDataProvider {
  readonly id = "PLAID" as const;
  readonly displayName = "Plaid";
  readonly isSimulated = false;

  isConfigured() {
    const e = env();
    return Boolean(e.PLAID_CLIENT_ID && e.PLAID_SECRET);
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const e = env();
    if (!this.isConfigured()) throw new ProviderError("NOT_CONFIGURED", "Bank connections are not configured on this server.");
    let res: Response;
    try {
      res = await fetch(`${BASE_URLS[e.PLAID_ENV]}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: e.PLAID_CLIENT_ID, secret: e.PLAID_SECRET, ...body }),
        cache: "no-store",
      });
    } catch {
      throw new ProviderError("PROVIDER_UNAVAILABLE", "We couldn't reach our banking data provider. Please try again shortly.", true);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(data.error_code ?? "");
      // Only the error code is inspected; the raw payload is never logged or surfaced.
      if (code === "ITEM_LOGIN_REQUIRED" || code === "PENDING_EXPIRATION") throw new ProviderError("LOGIN_REQUIRED", "Your bank needs you to sign in again to keep syncing.");
      if (code === "INSTITUTION_DOWN" || code === "INSTITUTION_NOT_RESPONDING") throw new ProviderError("INSTITUTION_UNAVAILABLE", "Your bank is not responding right now. We'll try again later.", true);
      if (res.status === 429 || code === "RATE_LIMIT_EXCEEDED") throw new ProviderError("RATE_LIMITED", "Too many requests to the bank provider. Please try again later.", true);
      if (res.status >= 500) throw new ProviderError("PROVIDER_UNAVAILABLE", "Our banking data provider is having trouble. Please try again shortly.", true);
      throw new ProviderError("INVALID_REQUEST", "The bank provider rejected the request.");
    }
    return data as T;
  }

  async createLinkSession(userId: string, opts?: { accessToken?: string }): Promise<LinkSession> {
    const e = env();
    const data = await this.call<{ link_token: string; expiration: string }>("/link/token/create", {
      user: { client_user_id: userId },
      client_name: "Harbour",
      language: "en",
      country_codes: ["CA"],
      ...(opts?.accessToken ? { access_token: opts.accessToken } : { products: ["transactions"], transactions: { days_requested: 730 } }),
      ...(e.PLAID_WEBHOOK_URL ? { webhook: e.PLAID_WEBHOOK_URL } : {}),
    });
    return { provider: "PLAID", mode: "plaid_link", linkToken: data.link_token, expiresAt: data.expiration };
  }

  async exchangePublicToken(_userId: string, publicToken: string, metadata?: Record<string, unknown>): Promise<ExchangeResult> {
    const data = await this.call<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
    const inst = (metadata?.institution ?? {}) as { institution_id?: string; name?: string };
    return {
      providerItemId: data.item_id,
      accessToken: data.access_token,
      institution: { providerInstitutionId: inst.institution_id ?? "unknown", name: inst.name ?? "Your bank", country: "CA" },
    };
  }

  private mapAccounts(accounts: PlaidAccount[]): ProviderAccount[] {
    return accounts.map((a) => {
      const type = mapType(a.type, a.subtype);
      return {
        providerAccountId: a.account_id,
        name: a.name,
        officialName: a.official_name,
        mask: a.mask,
        type,
        currency: a.balances.iso_currency_code ?? "CAD",
        currentBalanceCents: toCents(a.balances.current),
        availableBalanceCents: a.balances.available === null ? null : toCents(a.balances.available),
        creditLimitCents: a.balances.limit === null ? null : toCents(a.balances.limit),
      };
    });
  }

  async getAccounts(accessToken: string) {
    const data = await this.call<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: accessToken });
    return this.mapAccounts(data.accounts);
  }

  async getBalances(accessToken: string) {
    const data = await this.call<{ accounts: PlaidAccount[] }>("/accounts/balance/get", { access_token: accessToken });
    return this.mapAccounts(data.accounts);
  }

  private mapTxn(t: PlaidTxn): ProviderTransaction {
    return {
      providerTransactionId: t.transaction_id,
      providerAccountId: t.account_id,
      pendingTransactionId: t.pending_transaction_id,
      date: t.authorized_date ?? t.date,
      postedDate: t.pending ? null : t.date,
      amountCents: -toCents(t.amount),
      currency: t.iso_currency_code ?? "CAD",
      description: t.name,
      merchantName: t.merchant_name,
      pending: t.pending,
      categoryHint: t.personal_finance_category ? (PFC_MAP[t.personal_finance_category.primary] ?? null) : null,
    };
  }

  async getTransactions(accessToken: string, query: TransactionQuery): Promise<TransactionPage> {
    const data = await this.call<{ added: PlaidTxn[]; modified: PlaidTxn[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean }>(
      "/transactions/sync",
      { access_token: accessToken, cursor: query.cursor ?? undefined, count: 250, options: { include_personal_finance_category: true } },
    );
    return {
      added: data.added.map((t) => this.mapTxn(t)),
      modified: data.modified.map((t) => this.mapTxn(t)),
      removed: data.removed.map((r) => r.transaction_id),
      nextCursor: data.next_cursor,
      hasMore: data.has_more,
    };
  }

  async disconnectAccount(accessToken: string) {
    await this.call("/item/remove", { access_token: accessToken });
  }
}
