import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/banking/types";

// Fictional configuration only — no real credentials, and fetch is always stubbed (no network).
const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/config/env", () => ({ env: () => config.current }));

const { PlaidProvider } = await import("@/lib/banking/providers/plaid");
const { FlinksProvider } = await import("@/lib/banking/providers/flinks");

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };
let calls: Call[] = [];

/** Stubs fetch with a queue of [status, json] answers and records each request. */
function stubFetch(...answers: [number, unknown][]) {
  const queue = [...answers];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch");
    const [status, json] = next;
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PlaidProvider", () => {
  const SECRET = "plaid-secret-fictional";
  beforeEach(() => {
    config.current = { PLAID_CLIENT_ID: "client-fictional", PLAID_SECRET: SECRET, PLAID_ENV: "sandbox", appEnv: "test" };
  });

  it("refuses to call Plaid when it is not configured", async () => {
    config.current = { PLAID_ENV: "sandbox" };
    const fetchMock = stubFetch();
    const plaid = new PlaidProvider();
    expect(plaid.isConfigured()).toBe(false);
    await expect(plaid.getAccounts("access-sandbox-fictional")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps account types and balances to cents with liabilities as amounts owed", async () => {
    const acct = (account_id: string, type: string, subtype: string | null, current: number | null, extra: Record<string, unknown> = {}) => ({
      account_id,
      name: `Fictional ${account_id}`,
      official_name: null,
      mask: "0000",
      type,
      subtype,
      balances: { current, available: null, limit: null, iso_currency_code: "CAD", ...extra },
    });
    stubFetch([
      200,
      {
        accounts: [
          acct("chq", "depository", "checking", 1234.56, { available: 1200.1 }),
          acct("sav", "depository", "savings", 0.1 + 0.2),
          acct("cc", "credit", "credit card", 456.78, { limit: 5000 }),
          acct("loc", "credit", "line of credit", 1000),
          acct("mtg", "loan", "mortgage", 250000),
          acct("stu", "loan", "student", 12000),
          acct("inv", "investment", "tfsa", 9999.99),
          acct("oth", "other", null, null, { iso_currency_code: null }),
        ],
      },
    ]);
    const accounts = await new PlaidProvider().getAccounts("access-sandbox-fictional");
    expect(accounts.map((a) => [a.providerAccountId, a.type, a.currentBalanceCents])).toEqual([
      ["chq", "CHEQUING", 123456],
      ["sav", "SAVINGS", 30],
      ["cc", "CREDIT_CARD", 45678],
      ["loc", "LINE_OF_CREDIT", 100000],
      ["mtg", "MORTGAGE", 25000000],
      ["stu", "LOAN", 1200000],
      ["inv", "INVESTMENT", 999999],
      ["oth", "OTHER_ASSET", 0],
    ]);
    expect(accounts[0]).toMatchObject({ availableBalanceCents: 120010, creditLimitCents: null, currency: "CAD" });
    expect(accounts[2]).toMatchObject({ creditLimitCents: 500000, availableBalanceCents: null });
    expect(accounts[7].currency).toBe("CAD");
    expect(calls[0]).toMatchObject({ url: "https://sandbox.plaid.com/accounts/get", method: "POST" });
    expect(calls[0].body).toMatchObject({ client_id: "client-fictional", secret: SECRET, access_token: "access-sandbox-fictional" });
    expect(calls[0].url).not.toContain(SECRET);
  });

  it("negates Plaid amounts (positive = money out) and maps categories", async () => {
    const txn = (transaction_id: string, amount: number, extra: Record<string, unknown> = {}) => ({
      transaction_id,
      account_id: "chq",
      pending_transaction_id: null,
      date: "2026-09-30",
      authorized_date: null,
      amount,
      iso_currency_code: "CAD",
      name: `FICTIONAL ${transaction_id}`,
      merchant_name: null,
      pending: false,
      personal_finance_category: null,
      ...extra,
    });
    stubFetch([
      200,
      {
        added: [
          txn("purchase", 12.34, { authorized_date: "2026-09-28", merchant_name: "Metro", personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "x" } }),
          txn("payroll", -1845, { personal_finance_category: { primary: "INCOME", detailed: "x" } }),
          txn("pending", 5.5, { pending: true, pending_transaction_id: null, personal_finance_category: { primary: "SOMETHING_NEW", detailed: "x" } }),
        ],
        modified: [txn("posted", 7.25, { pending_transaction_id: "pending-old" })],
        removed: [{ transaction_id: "gone" }],
        next_cursor: "cursor-2",
        has_more: true,
      },
    ]);
    const page = await new PlaidProvider().getTransactions("access-sandbox-fictional", { cursor: "cursor-1", startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(page.added[0]).toEqual({
      providerTransactionId: "purchase",
      providerAccountId: "chq",
      pendingTransactionId: null,
      date: "2026-09-28",
      postedDate: "2026-09-30",
      amountCents: -1234,
      currency: "CAD",
      description: "FICTIONAL purchase",
      merchantName: "Metro",
      pending: false,
      categoryHint: "restaurants",
    });
    expect(page.added[1]).toMatchObject({ amountCents: 184500, categoryHint: "income" });
    expect(page.added[2]).toMatchObject({ amountCents: -550, pending: true, postedDate: null, categoryHint: null });
    expect(page.modified[0]).toMatchObject({ providerTransactionId: "posted", pendingTransactionId: "pending-old", amountCents: -725 });
    expect(page).toMatchObject({ removed: ["gone"], nextCursor: "cursor-2", hasMore: true });
    expect(calls[0].body).toMatchObject({ cursor: "cursor-1", count: 250, access_token: "access-sandbox-fictional" });
  });

  it.each([
    [400, { error_code: "ITEM_LOGIN_REQUIRED" }, "LOGIN_REQUIRED", false],
    [400, { error_code: "PENDING_EXPIRATION" }, "LOGIN_REQUIRED", false],
    [400, { error_code: "INSTITUTION_DOWN" }, "INSTITUTION_UNAVAILABLE", true],
    [429, { error_code: "RATE_LIMIT_EXCEEDED" }, "RATE_LIMITED", true],
    [503, {}, "PROVIDER_UNAVAILABLE", true],
    [400, { error_code: "INVALID_FIELD" }, "INVALID_REQUEST", false],
  ])("maps HTTP %i %j to %s", async (status, body, code, retryable) => {
    stubFetch([status, { ...body, error_message: "account 000123456789 secret detail" }]);
    const error = await new PlaidProvider().getAccounts("access-sandbox-fictional").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code, retryable });
    // The provider's raw payload never reaches the user-facing message.
    expect((error as Error).message).not.toMatch(/000123456789|secret detail/);
  });

  it("treats a network failure as a retryable outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(new PlaidProvider().getAccounts("access-sandbox-fictional")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("creates Canadian link sessions and exchanges public tokens", async () => {
    config.current = { ...config.current, PLAID_WEBHOOK_URL: "https://example.test/api/webhooks/plaid" };
    stubFetch([200, { link_token: "link-sandbox-fictional", expiration: "2026-10-01T12:30:00Z" }], [200, { access_token: "access-sandbox-fictional", item_id: "item-fictional" }]);
    const plaid = new PlaidProvider();
    expect(await plaid.createLinkSession("user-1")).toEqual({ provider: "PLAID", mode: "plaid_link", linkToken: "link-sandbox-fictional", expiresAt: "2026-10-01T12:30:00Z" });
    expect(calls[0].body).toMatchObject({ user: { client_user_id: "user-1" }, country_codes: ["CA"], products: ["transactions"], webhook: "https://example.test/api/webhooks/plaid" });
    const exchange = await plaid.exchangePublicToken("user-1", "public-sandbox-fictional", { institution: { institution_id: "ins_fictional", name: "Fictional Bank" } });
    expect(exchange).toEqual({ providerItemId: "item-fictional", accessToken: "access-sandbox-fictional", institution: { providerInstitutionId: "ins_fictional", name: "Fictional Bank", country: "CA" } });
  });
});

describe("FlinksProvider", () => {
  const LOGIN = "8b35f6c8-e7b6-41d3-98f8-08d68b7f8d31";
  beforeEach(() => {
    config.current = {
      FLINKS_CUSTOMER_ID: "customer-fictional",
      FLINKS_API_URL: "https://flinks.example.test/",
      FLINKS_CONNECT_URL: "https://connect.example.test/v2/",
      FLINKS_SECRET: "flinks-secret-fictional",
      FLINKS_API_KEY: "flinks-api-key-fictional",
      APP_URL: "http://localhost:3105",
      appEnv: "test",
    };
  });

  const detail = {
    InstitutionName: "Fictional Credit Union",
    Accounts: [
      {
        Id: "acc-chq",
        Title: "Chequing",
        AccountNumber: "000-12345-6789",
        Type: "Chequing",
        Currency: "CAD",
        Balance: { Current: 1500.25, Available: 1400 },
        Transactions: [
          { Id: "t-old", Date: "2026-08-01T00:00:00", Description: "OLD", Debit: 5 },
          { Id: "t-in", Date: "2026-09-15T00:00:00", Description: "PAYROLL", Credit: 1845 },
          { Id: "t-out", Date: "2026-09-20T00:00:00", Description: "METRO", Debit: 45.12 },
        ],
      },
      { Id: "acc-cc", Title: "Visa", LastFourDigits: "4242", Type: "CreditCard", Category: "Credits", Balance: { Current: -456.78, Limit: 5000 } },
    ],
  };

  it("rejects a malformed loginId without calling Flinks", async () => {
    const fetchMock = stubFetch();
    await expect(new FlinksProvider().exchangePublicToken("user-1", "not-a-login")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authorizes, requests minimal account details and maps balances", async () => {
    stubFetch([200, { Token: "authorize-token-fictional" }], [200, { RequestId: "req-1", Institution: "Fictional Credit Union" }], [200, detail]);
    const accounts = await new FlinksProvider().getAccounts(LOGIN);
    expect(calls.map((c) => c.url)).toEqual([
      "https://flinks.example.test/v3/customer-fictional/BankingServices/GenerateAuthorizeToken",
      "https://flinks.example.test/v3/customer-fictional/BankingServices/Authorize",
      "https://flinks.example.test/v3/customer-fictional/BankingServices/GetAccountsDetail",
    ]);
    expect(calls[0].headers["flinks-auth-key"]).toBe("flinks-secret-fictional");
    expect(calls[1].headers["flinks-auth-key"]).toBe("authorize-token-fictional");
    expect(calls[1].body).toEqual({ LoginId: LOGIN, MostRecentCached: true });
    expect(calls[2].headers["x-api-key"]).toBe("flinks-api-key-fictional");
    expect(calls[2].body).toMatchObject({ RequestId: "req-1", WithTransactions: false, WithAccountIdentity: false, WithKYC: false });
    expect(accounts).toEqual([
      { providerAccountId: "acc-chq", name: "Chequing", officialName: "Chequing", mask: "6789", type: "CHEQUING", currency: "CAD", currentBalanceCents: 150025, availableBalanceCents: 140000, creditLimitCents: null },
      { providerAccountId: "acc-cc", name: "Visa", officialName: "Visa", mask: "4242", type: "CREDIT_CARD", currency: "CAD", currentBalanceCents: 45678, availableBalanceCents: null, creditLimitCents: 500000 },
    ]);
  });

  it("returns signed transactions inside the requested window only", async () => {
    stubFetch([200, { Token: "t" }], [200, { RequestId: "req-2" }], [200, detail]);
    const page = await new FlinksProvider().getTransactions(LOGIN, { startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(page.added.map((t) => [t.providerTransactionId, t.date, t.amountCents])).toEqual([
      ["t-in", "2026-09-15", 184500],
      ["t-out", "2026-09-20", -4512],
    ]);
    expect(page).toMatchObject({ modified: [], removed: [], nextCursor: null, hasMore: false });
    expect(calls[2].body).toMatchObject({ WithTransactions: true, DaysOfTransactions: "Days90" });
  });

  it("polls while Flinks prepares the data", async () => {
    vi.useFakeTimers();
    stubFetch([200, { Token: "t" }], [200, { RequestId: "req-3" }], [202, { FlinksCode: "OPERATION_PENDING" }], [202, {}], [200, detail]);
    const promise = new FlinksProvider().getAccounts(LOGIN);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await promise).toHaveLength(2);
    expect(calls.slice(3).map((c) => [c.method, c.url.split("/").slice(-2).join("/")])).toEqual([
      ["GET", "GetAccountsDetailAsync/req-3"],
      ["GET", "GetAccountsDetailAsync/req-3"],
    ]);
  });

  it.each([
    [401, {}, "LOGIN_REQUIRED"],
    [400, { FlinksCode: "SESSION_EXPIRED" }, "LOGIN_REQUIRED"],
    [429, {}, "RATE_LIMITED"],
    [500, {}, "PROVIDER_UNAVAILABLE"],
    [400, { FlinksCode: "SOMETHING_ELSE" }, "INVALID_REQUEST"],
  ])("maps an Authorize failure %i %j to %s", async (status, body, code) => {
    stubFetch([200, { Token: "t" }], [status, body]);
    await expect(new FlinksProvider().getAccounts(LOGIN)).rejects.toMatchObject({ code });
  });

  it("reports a rejected secret as a configuration problem", async () => {
    stubFetch([401, {}]);
    await expect(new FlinksProvider().getAccounts(LOGIN)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("builds the Connect URL with a fresh authorize token and our redirect", async () => {
    stubFetch([200, { Token: "authorize-token-fictional" }]);
    const session = await new FlinksProvider().createLinkSession("user-1", { language: "fr" });
    const url = new URL(session.url!);
    expect(session).toMatchObject({ provider: "FLINKS", mode: "iframe" });
    expect(url.origin + url.pathname).toBe("https://connect.example.test/v2/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      authorizeToken: "authorize-token-fictional",
      redirectUrl: "http://localhost:3105/accounts/connect",
      language: "fr",
      demo: "true",
    });
    expect(session.url).not.toContain("flinks-secret-fictional");
  });
});
