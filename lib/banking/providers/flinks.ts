import type { AccountType } from "@prisma/client";
import { env } from "@/lib/config/env";
import { addDays, daysBetween, type LocalDate } from "@/lib/dates";
import { ProviderError, type ExchangeResult, type FinancialDataProvider, type LinkSession, type ProviderAccount, type ProviderTransaction, type TransactionPage, type TransactionQuery } from "../types";

/**
 * Flinks adapter (Canadian open-banking aggregator).
 *
 * Flow: the user authenticates inside the hosted Flinks Connect iframe, which returns a
 * `loginId` to our page via postMessage. We treat that loginId as the "public token":
 * /Authorize with it yields a RequestId used to read accounts and transactions.
 * Flinks is range-based (no cursor), so our duplicate detection handles overlaps.
 *
 * Endpoint shapes follow the Flinks BankingServices API; verify field names against
 * your Flinks instance documentation before going live (see docs/PROVIDERS.md).
 */
interface FlinksAccount {
  Id: string;
  Title: string;
  AccountNumber?: string;
  Category?: string; // "Operations" | "Credits" | "Products"
  Type?: string; // "Chequing" | "Savings" | "CreditCard" | "LineOfCredit" | "Mortgage" | "TFSA" | "RRSP" …
  Currency?: string;
  Balance?: { Current?: number | null; Available?: number | null; Limit?: number | null };
  Transactions?: { Id: string; Date: string; Description: string; Debit?: number | null; Credit?: number | null }[];
}

function toCents(n: number | null | undefined): number {
  if (n === null || n === undefined) return 0;
  const [whole, frac = ""] = Math.abs(n).toFixed(2).split(".");
  const c = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return n < 0 ? -c : c;
}

function mapType(a: FlinksAccount): AccountType {
  const t = (a.Type ?? "").toLowerCase();
  if (t.includes("credit")) return t.includes("line") ? "LINE_OF_CREDIT" : "CREDIT_CARD";
  if (t.includes("mortgage")) return "MORTGAGE";
  if (t.includes("loan")) return "LOAN";
  if (t.includes("saving")) return "SAVINGS";
  if (["tfsa", "rrsp", "resp", "fhsa", "investment", "brokerage"].some((k) => t.includes(k))) return "INVESTMENT";
  if (a.Category === "Credits") return "CREDIT_CARD";
  return "CHEQUING";
}

export class FlinksProvider implements FinancialDataProvider {
  readonly id = "FLINKS" as const;
  readonly displayName = "Flinks";
  readonly isSimulated = false;

  isConfigured() {
    const e = env();
    return Boolean(e.FLINKS_CUSTOMER_ID && e.FLINKS_API_URL && e.FLINKS_CONNECT_URL);
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const e = env();
    if (!this.isConfigured()) throw new ProviderError("NOT_CONFIGURED", "Bank connections are not configured on this server.");
    let res: Response;
    try {
      res = await fetch(`${e.FLINKS_API_URL}/v3/${e.FLINKS_CUSTOMER_ID}/BankingServices/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(e.FLINKS_SECRET ? { "x-api-key": e.FLINKS_SECRET } : {}) },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new ProviderError("PROVIDER_UNAVAILABLE", "We couldn't reach our banking data provider. Please try again shortly.", true);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401 || data.FlinksCode === "SESSION_EXPIRED" || data.FlinksCode === "INVALID_LOGIN") {
      throw new ProviderError("LOGIN_REQUIRED", "Your bank needs you to sign in again to keep syncing.");
    }
    if (res.status === 202) throw new ProviderError("PROVIDER_UNAVAILABLE", "Your bank is still preparing data. Please try syncing again in a minute.", true);
    if (!res.ok) throw new ProviderError(res.status >= 500 ? "PROVIDER_UNAVAILABLE" : "INVALID_REQUEST", "The bank provider could not complete the request.", res.status >= 500);
    return data as T;
  }

  async createLinkSession(): Promise<LinkSession> {
    const e = env();
    if (!this.isConfigured()) throw new ProviderError("NOT_CONFIGURED", "Bank connections are not configured on this server.");
    const url = new URL(e.FLINKS_CONNECT_URL!);
    url.searchParams.set("innerRedirect", "true");
    url.searchParams.set("consentEnable", "true");
    url.searchParams.set("language", "en");
    return { provider: "FLINKS", mode: "iframe", url: url.toString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
  }

  async exchangePublicToken(_userId: string, loginId: string, metadata?: Record<string, unknown>): Promise<ExchangeResult> {
    await this.authorize(loginId);
    const institution = String(metadata?.institution ?? "Your bank");
    return { providerItemId: loginId, accessToken: loginId, institution: { providerInstitutionId: institution.toLowerCase().replace(/\W+/g, "-"), name: institution, country: "CA" } };
  }

  private async authorize(loginId: string): Promise<string> {
    const data = await this.call<{ RequestId: string }>("Authorize", { LoginId: loginId, MostRecentCached: true });
    if (!data.RequestId) throw new ProviderError("PROVIDER_UNAVAILABLE", "The bank provider did not return a session.", true);
    return data.RequestId;
  }

  private async details(loginId: string, withTransactions: boolean, days = 90) {
    const requestId = await this.authorize(loginId);
    const window = days > 90 ? "Days365" : "Days90";
    return this.call<{ Accounts: FlinksAccount[] }>("GetAccountsDetail", { RequestId: requestId, WithTransactions: withTransactions, DaysOfTransactions: window, WithBalance: true });
  }

  private mapAccount(a: FlinksAccount): ProviderAccount {
    const type = mapType(a);
    const liability = ["CREDIT_CARD", "LINE_OF_CREDIT", "LOAN", "MORTGAGE"].includes(type);
    const current = toCents(a.Balance?.Current);
    return {
      providerAccountId: a.Id,
      name: a.Title,
      officialName: a.Title,
      mask: a.AccountNumber ? a.AccountNumber.slice(-4) : null,
      type,
      currency: a.Currency ?? "CAD",
      currentBalanceCents: liability ? Math.abs(current) : current,
      availableBalanceCents: a.Balance?.Available === undefined || a.Balance?.Available === null ? null : toCents(a.Balance.Available),
      creditLimitCents: a.Balance?.Limit ? toCents(a.Balance.Limit) : null,
    };
  }

  async getAccounts(accessToken: string) {
    const data = await this.details(accessToken, false);
    return data.Accounts.map((a) => this.mapAccount(a));
  }

  async getBalances(accessToken: string) {
    return this.getAccounts(accessToken);
  }

  async getTransactions(accessToken: string, query: TransactionQuery): Promise<TransactionPage> {
    const span = daysBetween(query.startDate, query.endDate);
    const data = await this.details(accessToken, true, span);
    const added: ProviderTransaction[] = [];
    for (const a of data.Accounts) {
      for (const t of a.Transactions ?? []) {
        const date = t.Date.slice(0, 10) as LocalDate;
        if (date < query.startDate || date > addDays(query.endDate, 0)) continue;
        const amount = toCents(t.Credit ?? 0) - toCents(t.Debit ?? 0);
        added.push({ providerTransactionId: t.Id, providerAccountId: a.Id, date, postedDate: date, amountCents: amount, currency: a.Currency ?? "CAD", description: t.Description, merchantName: null, pending: false });
      }
    }
    return { added, modified: [], removed: [], nextCursor: null, hasMore: false };
  }

  async disconnectAccount(accessToken: string) {
    await this.call("DeleteCard", { LoginId: accessToken }).catch(() => undefined);
  }
}
