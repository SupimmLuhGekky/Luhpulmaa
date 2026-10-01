import type { AccountType } from "@prisma/client";
import { env } from "@/lib/config/env";
import { daysBetween, type LocalDate } from "@/lib/dates";
import { ProviderError, type ExchangeResult, type FinancialDataProvider, type LinkSession, type ProviderAccount, type ProviderTransaction, type TransactionPage, type TransactionQuery } from "../types";

/**
 * Flinks adapter (Canadian open-banking aggregator). Flinks is the provider that
 * covers Neo Financial, so it is the first real adapter to harden.
 *
 * Flow (Flinks "authorize token" model, mandatory since Oct 2024):
 *  1. Server: POST /GenerateAuthorizeToken with the secret key → short-lived token.
 *  2. Browser: the hosted Flinks Connect iframe is opened with `authorizeToken=…`.
 *     The user signs in to their bank inside Flinks; we never see credentials.
 *     On success the iframe posts a `REDIRECT` message carrying the `loginId`.
 *  3. Server: the loginId is our long-lived "access token". For every data read we
 *     generate a fresh authorize token, call /Authorize (MostRecentCached) to get a
 *     RequestId, then /GetAccountsDetail. A 202 OPERATION_PENDING answer is polled
 *     via /GetAccountsDetailAsync/{requestId}.
 *
 * Flinks is range-based (no cursor), so overlapping windows are expected; duplicate
 * detection in the sync pipeline handles them. Field names follow the Flinks v3
 * BankingServices API; check them against your Flinks instance before going live
 * (see docs/PROVIDERS.md).
 */
interface FlinksTransaction {
  Id: string;
  Date: string;
  Description: string;
  Debit?: number | null;
  Credit?: number | null;
}

interface FlinksAccount {
  Id: string;
  Title: string;
  LastFourDigits?: string | null;
  AccountNumber?: string | null;
  Category?: string; // "Operations" | "Credits" | "Products"
  Type?: string; // "Chequing" | "Savings" | "CreditCard" | "LineOfCredit" | "Mortgage" | "TFSA" | "RRSP" …
  Currency?: string;
  Balance?: { Current?: number | null; Available?: number | null; Limit?: number | null };
  Transactions?: FlinksTransaction[];
}

interface FlinksDetail {
  Accounts?: FlinksAccount[];
  InstitutionName?: string;
}

/** Poll budget for 202 answers inside one request; the next sync picks up anything slower. */
const ASYNC_POLL_MS = 10_000;
const ASYNC_MAX_POLLS = 5;

function toCents(n: number | null | undefined): number {
  if (n === null || n === undefined || !Number.isFinite(n)) return 0;
  const [whole, frac = ""] = Math.abs(n).toFixed(2).split(".");
  const c = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return n < 0 ? -c : c;
}

export function mapFlinksAccountType(a: Pick<FlinksAccount, "Type" | "Category">): AccountType {
  const t = (a.Type ?? "").toLowerCase();
  if (t.includes("credit")) return t.includes("line") ? "LINE_OF_CREDIT" : "CREDIT_CARD";
  if (t.includes("mortgage")) return "MORTGAGE";
  if (t.includes("loan")) return "LOAN";
  if (t.includes("saving")) return "SAVINGS";
  if (["tfsa", "rrsp", "resp", "fhsa", "investment", "brokerage"].some((k) => t.includes(k))) return "INVESTMENT";
  if (a.Category === "Credits") return "CREDIT_CARD";
  return "CHEQUING";
}

/** Flinks reports debits and credits as positive numbers; we sign from the holder's view. */
export function mapFlinksTransaction(t: FlinksTransaction, account: Pick<FlinksAccount, "Id" | "Currency">): ProviderTransaction {
  const date = t.Date.slice(0, 10) as LocalDate;
  return {
    providerTransactionId: t.Id,
    providerAccountId: account.Id,
    date,
    postedDate: date,
    amountCents: toCents(t.Credit ?? 0) - toCents(t.Debit ?? 0),
    currency: account.Currency ?? "CAD",
    description: t.Description?.trim() || "Transaction",
    merchantName: null,
    pending: false,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FlinksProvider implements FinancialDataProvider {
  readonly id = "FLINKS" as const;
  readonly displayName = "Flinks";
  readonly isSimulated = false;
  readonly reportsRemovals = false;

  isConfigured() {
    const e = env();
    return Boolean(e.FLINKS_CUSTOMER_ID && e.FLINKS_API_URL && e.FLINKS_CONNECT_URL && e.FLINKS_SECRET);
  }

  private base() {
    const e = env();
    if (!this.isConfigured()) throw new ProviderError("NOT_CONFIGURED", "Bank connections are not configured on this server.");
    return `${e.FLINKS_API_URL!.replace(/\/+$/, "")}/v3/${e.FLINKS_CUSTOMER_ID}/BankingServices`;
  }

  private async request(method: "GET" | "POST" | "DELETE", path: string, headers: Record<string, string>, body?: Record<string, unknown>) {
    let res: Response;
    try {
      res = await fetch(`${this.base()}/${path}`, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ProviderError("PROVIDER_UNAVAILABLE", "We couldn't reach our banking data provider. Please try again shortly.", true);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data };
  }

  private fail(status: number, data: Record<string, unknown>): never {
    const code = String(data.FlinksCode ?? "");
    if (status === 401 || status === 203 || ["SESSION_EXPIRED", "INVALID_LOGIN", "DISABLED_LOGIN", "QUESTION_NOT_FOUND", "INVALID_USERNAME", "INVALID_PASSWORD"].includes(code)) {
      throw new ProviderError("LOGIN_REQUIRED", "Your bank needs you to sign in again to keep syncing.");
    }
    if (status === 429) throw new ProviderError("RATE_LIMITED", "The bank provider is busy. We'll try again shortly.", true);
    if (code === "SESSION_NONEXISTENT") throw new ProviderError("PROVIDER_UNAVAILABLE", "The bank session ended before data was ready. Please sync again.", true);
    if (status >= 500) throw new ProviderError("PROVIDER_UNAVAILABLE", "The bank provider could not complete the request.", true);
    throw new ProviderError("INVALID_REQUEST", "The bank provider could not complete the request.");
  }

  /** Data endpoints authenticate with the API key when the instance requires one. */
  private dataHeaders(): Record<string, string> {
    const key = env().FLINKS_API_KEY;
    return key ? { "x-api-key": key } : {};
  }

  /** Short-lived token for Flinks Connect and /Authorize (expires after 30 min idle). */
  private async generateAuthorizeToken(): Promise<string> {
    const { status, data } = await this.request("POST", "GenerateAuthorizeToken", { "flinks-auth-key": env().FLINKS_SECRET! });
    if (status === 401) throw new ProviderError("NOT_CONFIGURED", "Bank connections are misconfigured on this server.");
    if (status !== 200 || typeof data.Token !== "string") this.fail(status, data);
    return data.Token as string;
  }

  async createLinkSession(_userId: string, opts?: { language?: "en" | "fr" }): Promise<LinkSession> {
    const e = env();
    const token = await this.generateAuthorizeToken();
    const url = new URL(e.FLINKS_CONNECT_URL!);
    url.searchParams.set("authorizeToken", token);
    url.searchParams.set("innerRedirect", "true");
    url.searchParams.set("redirectUrl", `${e.APP_URL.replace(/\/+$/, "")}/accounts/connect`);
    url.searchParams.set("consentEnable", "true");
    url.searchParams.set("daysOfTransactions", "Days365");
    url.searchParams.set("institutionFilterEnable", "true");
    url.searchParams.set("language", opts?.language ?? "en");
    url.searchParams.set("theme", "system");
    if (e.appEnv !== "production") url.searchParams.set("demo", "true");
    return { provider: "FLINKS", mode: "iframe", url: url.toString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
  }

  async exchangePublicToken(_userId: string, loginId: string, metadata?: Record<string, unknown>): Promise<ExchangeResult> {
    if (!/^[0-9a-f-]{36}$/i.test(loginId)) throw new ProviderError("INVALID_REQUEST", "The bank connection didn't complete. Please try again.");
    const { institution } = await this.authorize(loginId);
    const name = institution ?? (typeof metadata?.institution === "string" ? metadata.institution : "Your bank");
    return { providerItemId: loginId, accessToken: loginId, institution: { providerInstitutionId: name.toLowerCase().replace(/\W+/g, "-"), name, country: "CA" } };
  }

  private async authorize(loginId: string): Promise<{ requestId: string; institution: string | null }> {
    const token = await this.generateAuthorizeToken();
    const { status, data } = await this.request("POST", "Authorize", { "flinks-auth-key": token }, { LoginId: loginId, MostRecentCached: true });
    if (status !== 200 || typeof data.RequestId !== "string") this.fail(status, data);
    return { requestId: data.RequestId as string, institution: typeof data.Institution === "string" ? data.Institution : null };
  }

  private async details(loginId: string, withTransactions: boolean, days = 90): Promise<FlinksDetail> {
    const { requestId } = await this.authorize(loginId);
    let { status, data } = await this.request("POST", "GetAccountsDetail", this.dataHeaders(), {
      RequestId: requestId,
      WithTransactions: withTransactions,
      DaysOfTransactions: days > 90 ? "Days365" : "Days90",
      WithBalance: true,
      // Data minimisation: we never need full account numbers or the holder's identity.
      WithAccountIdentity: false,
      WithKYC: false,
    });
    for (let i = 0; status === 202 && i < ASYNC_MAX_POLLS; i++) {
      await sleep(ASYNC_POLL_MS);
      ({ status, data } = await this.request("GET", `GetAccountsDetailAsync/${encodeURIComponent(requestId)}`, this.dataHeaders()));
    }
    if (status === 202) throw new ProviderError("PROVIDER_UNAVAILABLE", "Your bank is still preparing data. We'll finish syncing on the next refresh.", true);
    if (status !== 200) this.fail(status, data);
    return data as FlinksDetail;
  }

  private mapAccount(a: FlinksAccount): ProviderAccount {
    const type = mapFlinksAccountType(a);
    const liability = ["CREDIT_CARD", "LINE_OF_CREDIT", "LOAN", "MORTGAGE"].includes(type);
    const current = toCents(a.Balance?.Current);
    const last4 = a.LastFourDigits ?? (a.AccountNumber ? a.AccountNumber.replace(/\D/g, "").slice(-4) : null);
    return {
      providerAccountId: a.Id,
      name: a.Title,
      officialName: a.Title,
      mask: last4 || null,
      type,
      currency: a.Currency ?? "CAD",
      currentBalanceCents: liability ? Math.abs(current) : current,
      availableBalanceCents: a.Balance?.Available === undefined || a.Balance?.Available === null ? null : toCents(a.Balance.Available),
      creditLimitCents: a.Balance?.Limit ? toCents(a.Balance.Limit) : null,
    };
  }

  async getAccounts(accessToken: string) {
    const data = await this.details(accessToken, false);
    return (data.Accounts ?? []).map((a) => this.mapAccount(a));
  }

  async getBalances(accessToken: string) {
    return this.getAccounts(accessToken);
  }

  async getTransactions(accessToken: string, query: TransactionQuery): Promise<TransactionPage> {
    const data = await this.details(accessToken, true, daysBetween(query.startDate, query.endDate));
    const added: ProviderTransaction[] = [];
    for (const a of data.Accounts ?? []) {
      for (const t of a.Transactions ?? []) {
        const tx = mapFlinksTransaction(t, a);
        if (tx.date < query.startDate || tx.date > query.endDate) continue;
        added.push(tx);
      }
    }
    return { added, modified: [], removed: [], nextCursor: null, hasMore: false };
  }

  async disconnectAccount(accessToken: string) {
    const { status, data } = await this.request("DELETE", `DeleteCard/${encodeURIComponent(accessToken)}`, this.dataHeaders());
    if (status !== 200) this.fail(status, data);
  }
}
