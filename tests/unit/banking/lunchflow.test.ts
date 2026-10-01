import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/banking/types";

// Fictional key and data only. fetch is always stubbed: nothing reaches lunchflow.app.
const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/config/env", () => ({ env: () => config.current }));

const {
  LunchFlowProvider,
  decimalToCents,
  decodeLunchFlowToken,
  encodeLunchFlowToken,
  guessLunchFlowAccountType,
  lunchFlowGroupKey,
  mapLunchFlowTransaction,
  parseLunchFlowDate,
} = await import("@/lib/banking/providers/lunchflow");

const KEY = "lf-fictional-unit-key";
const BASE = "https://lunchflow.example/api/v1";

type Answer = [status: number, body: unknown, headers?: Record<string, string>];
type Route = (url: URL) => Answer | Error;

let requests: { url: URL; init: RequestInit }[] = [];

/** Stubs fetch with a router (or a queue of answers) and records every request. */
function stubFetch(route: Route | Answer[]) {
  const queue = Array.isArray(route) ? [...route] : null;
  const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    requests.push({ url, init });
    const answer = queue ? queue.shift() : (route as Route)(url);
    if (!answer) throw new Error(`unexpected request to ${url.pathname}`);
    if (answer instanceof Error) throw answer;
    const [status, body, headers = {}] = answer;
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const NO_WAIT = { "Retry-After": "0" };

const card = { id: 9001, connection_id: 501, name: "Fictional Neo Mastercard", institution_name: "Fictional Neo Financial", status: "ACTIVE" };
const everyday = { id: "9002", connection_id: 501, name: "Fictional Everyday Account", institution_name: "Fictional Neo Financial", currency: "cad", status: "ACTIVE" };
const otherBank = { id: 7001, connection_id: 777, name: "Fictional Savings", institution_name: "Fictional Credit Union", currency: "CAD", status: "ACTIVE" };

/** A Lunch Flow with the three fictional accounts above. */
function lunchFlow(over: { transactions?: (id: string, from: string, to: string) => Answer; balances?: Record<string, Answer>; accounts?: unknown[] } = {}): Route {
  return (url) => {
    if (url.pathname === "/api/v1/accounts") return [200, { accounts: over.accounts ?? [card, everyday, otherBank], total: 3 }];
    const m = /^\/api\/v1\/accounts\/([^/]+)\/(balance|transactions)$/.exec(url.pathname);
    if (!m) return [404, { error: "Not Found" }];
    const id = decodeURIComponent(m[1]!);
    if (m[2] === "balance") {
      return (
        over.balances?.[id] ??
        ({ "9001": [200, { balance: { amount: -523.1, currency: "CAD" } }], "9002": [200, { balance: { amount: "1840.25", currency: "CAD" } }], "7001": [200, { balance: { amount: 50, currency: "CAD" } }] } as Record<string, Answer>)[id] ?? [404, { error: "Not Found" }]
      );
    }
    const from = url.searchParams.get("from")!;
    const to = url.searchParams.get("to")!;
    return over.transactions ? over.transactions(id, from, to) : [200, { transactions: [], total: 0 }];
  };
}

const token = (over: Partial<{ key: string; group: string; skip: string[] }> = {}) => encodeLunchFlowToken({ key: KEY, group: "connection:501", skip: [], ...over });

beforeEach(() => {
  requests = [];
  config.current = { LUNCHFLOW_API_URL: `${BASE}/`, appEnv: "test" };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Lunch Flow amounts and dates", () => {
  it("turns decimals into exact cents, rounding half away from zero", () => {
    expect(decimalToCents(-41.17)).toBe(-4117);
    expect(decimalToCents("-87.34")).toBe(-8734);
    expect(decimalToCents("1840.25")).toBe(184025);
    expect(decimalToCents(300)).toBe(30000);
    expect(decimalToCents("12")).toBe(1200);
    expect(decimalToCents("+12.5")).toBe(1250);
    expect(decimalToCents(" 0.1 ")).toBe(10);
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
    expect(decimalToCents("12.345")).toBe(1235);
    expect(decimalToCents("-12.345")).toBe(-1235);
    expect(decimalToCents("-12.344")).toBe(-1234);
  });

  it("never returns -0 and refuses what isn't a plain decimal", () => {
    expect(Object.is(decimalToCents("-0.00"), 0)).toBe(true);
    expect(Object.is(decimalToCents(-0), 0)).toBe(true);
    for (const bad of ["", "abc", "1,234.56", "$12.00", "1e3", "12.", ".5", "--1"]) expect(decimalToCents(bad)).toBeNull();
    expect(decimalToCents(Number.NaN)).toBeNull();
    expect(decimalToCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(decimalToCents(1e21)).toBeNull();
  });

  it("reads ISO dates, timestamps and Unix times as calendar days", () => {
    expect(parseLunchFlowDate("2026-09-30")).toBe("2026-09-30");
    expect(parseLunchFlowDate("2026-09-30T23:30:00-04:00")).toBe("2026-09-30");
    expect(parseLunchFlowDate(Date.UTC(2026, 8, 30, 12) / 1000)).toBe("2026-09-30");
    expect(parseLunchFlowDate(Date.UTC(2026, 8, 30, 12))).toBe("2026-09-30");
    for (const bad of ["", "30/09/2026", "2026-13-01", null, undefined, 0, -5, Number.NaN, {}]) expect(parseLunchFlowDate(bad)).toBeNull();
  });
});

describe("Lunch Flow accounts", () => {
  it("groups accounts by Lunch Flow bank connection, else by institution", () => {
    expect(lunchFlowGroupKey({ connection_id: 501, institution_name: "Fictional Neo Financial" })).toBe("connection:501");
    expect(lunchFlowGroupKey({ connection_id: " abc ", institution_name: null })).toBe("connection:abc");
    expect(lunchFlowGroupKey({ connection_id: null, institution_name: "Banque Fictive Québec" })).toBe("institution:banque-fictive-quebec");
    expect(lunchFlowGroupKey({ connection_id: "", institution_name: "" })).toBe("accounts");
  });

  it("suggests a type from the account's name", () => {
    expect(guessLunchFlowAccountType("Neo Mastercard")).toBe("CREDIT_CARD");
    expect(guessLunchFlowAccountType("Neo Secured Card")).toBe("CREDIT_CARD");
    expect(guessLunchFlowAccountType("Visa Infinite")).toBe("CREDIT_CARD");
    expect(guessLunchFlowAccountType("Carte de crédit")).toBe("CREDIT_CARD");
    expect(guessLunchFlowAccountType("Debit card")).toBe("CHEQUING");
    expect(guessLunchFlowAccountType("Personal Line of Credit")).toBe("LINE_OF_CREDIT");
    expect(guessLunchFlowAccountType("Marge de crédit")).toBe("LINE_OF_CREDIT");
    expect(guessLunchFlowAccountType("Hypothèque")).toBe("MORTGAGE");
    expect(guessLunchFlowAccountType("Car loan")).toBe("LOAN");
    expect(guessLunchFlowAccountType("Neo Invest TFSA")).toBe("INVESTMENT");
    expect(guessLunchFlowAccountType("Compte d'épargne")).toBe("SAVINGS");
    expect(guessLunchFlowAccountType("High Interest Savings")).toBe("SAVINGS");
    expect(guessLunchFlowAccountType("Neo Money")).toBe("CHEQUING");
  });

  it("reads every account with its balance, and finds a currency for each", async () => {
    stubFetch(lunchFlow());
    const accounts = await new LunchFlowProvider().discover(KEY);
    expect(accounts).toEqual([
      { providerAccountId: "9001", name: "Fictional Neo Mastercard", institution: "Fictional Neo Financial", group: "connection:501", currency: "CAD", balanceCents: -52310, guessedType: "CREDIT_CARD", active: true },
      { providerAccountId: "9002", name: "Fictional Everyday Account", institution: "Fictional Neo Financial", group: "connection:501", currency: "CAD", balanceCents: 184025, guessedType: "CHEQUING", active: true },
      { providerAccountId: "7001", name: "Fictional Savings", institution: "Fictional Credit Union", group: "connection:777", currency: "CAD", balanceCents: 5000, guessedType: "SAVINGS", active: true },
    ]);
    // Read-only GETs to the configured address, with the key in its header and never in the URL.
    expect(requests.map((r) => r.url.href)).toEqual([`${BASE}/accounts`, `${BASE}/accounts/9001/balance`, `${BASE}/accounts/9002/balance`, `${BASE}/accounts/7001/balance`]);
    for (const { url, init } of requests) {
      expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store", headers: { "x-api-key": KEY, Accept: "application/json" } });
      expect(url.href).not.toContain(KEY);
    }
  });

  it("fills in missing names and currencies, and notes accounts whose bank link needs attention", async () => {
    stubFetch(
      lunchFlow({
        accounts: [{ id: 1, name: null, institution_name: null, status: "DISCONNECTED" }, { id: 2, name: "  ", institution_name: "Fictional Bank", currency: "usd" }, { id: 3 }],
        balances: { "1": [200, { balance: { amount: "10", currency: null } }], "2": [200, { balance: { amount: 2 } }], "3": [200, { balance: { amount: 3, currency: "eur" } }] },
      }),
    );
    const accounts = await new LunchFlowProvider().discover(KEY);
    expect(accounts.map((a) => [a.name, a.institution, a.currency, a.active])).toEqual([
      ["Lunch Flow account", "Lunch Flow", "CAD", false],
      ["Fictional Bank account", "Fictional Bank", "USD", true],
      ["Lunch Flow account", "Lunch Flow", "EUR", true],
    ]);
  });

  it("leaves out an account Lunch Flow no longer has a balance for", async () => {
    stubFetch(lunchFlow({ balances: { "9002": [404, { error: "Not Found" }] } }));
    const accounts = await new LunchFlowProvider().discover(KEY);
    expect(accounts.map((a) => a.providerAccountId)).toEqual(["9001", "7001"]);
  });

  it("reports one Lunch Flow bank connection per Harbour connection, without the accounts left out", async () => {
    stubFetch(lunchFlow());
    const provider = new LunchFlowProvider();
    const accounts = await provider.getBalances(token({ skip: ["9002"] }));
    expect(accounts).toEqual([
      {
        providerAccountId: "9001",
        name: "Fictional Neo Mastercard",
        officialName: "Fictional Neo Mastercard",
        mask: null,
        type: "CREDIT_CARD",
        currency: "CAD",
        // Holder-signed: the sync turns it into an amount owed once it knows the account is a debt.
        currentBalanceCents: -52310,
        availableBalanceCents: null,
        creditLimitCents: null,
      },
    ]);
    expect(provider.reportsAccountTypes).toBe(false);
    expect(provider.reportsRemovals).toBe(false);
    expect(provider.isSimulated).toBe(false);
  });

  it("asks for the key again when Lunch Flow stops sharing the bank, and waits when its bank link is down", async () => {
    stubFetch(lunchFlow({ accounts: [otherBank] }));
    await expect(new LunchFlowProvider().getAccounts(token())).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });

    stubFetch(lunchFlow({ accounts: [{ ...card, status: "DISCONNECTED" }, { ...everyday, status: "ERROR" }] }));
    await expect(new LunchFlowProvider().getAccounts(token())).rejects.toMatchObject({
      code: "INSTITUTION_UNAVAILABLE",
      message: expect.stringContaining("Fictional Neo Financial"),
    });
  });
});

describe("Lunch Flow transactions", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "lf-1", accountId: 9001, amount: -5.25, currency: "CAD", date: "2026-09-29", merchant: "Fictional Corner Cafe", description: "FICTIONAL CORNER CAFE MONTREAL QC", isPending: false, ...over });

  it("maps a posted transaction to Harbour's conventions", () => {
    expect(mapLunchFlowTransaction(row(), "9001", "CAD")).toEqual({
      providerTransactionId: "lf-1",
      providerAccountId: "9001",
      date: "2026-09-29",
      postedDate: "2026-09-29",
      amountCents: -525,
      currency: "CAD",
      description: "FICTIONAL CORNER CAFE MONTREAL QC",
      merchantName: "Fictional Corner Cafe",
      pending: false,
    });
    expect(mapLunchFlowTransaction(row({ id: 42, amount: "300", merchant: null, description: "PAYMENT - THANK YOU", currency: null }), "9001", "CAD")).toMatchObject({
      providerTransactionId: "42",
      amountCents: 30000,
      currency: "CAD",
      description: "PAYMENT - THANK YOU",
      merchantName: null,
    });
    expect(mapLunchFlowTransaction(row({ description: " ", currency: "usd" }), "9001", "CAD")).toMatchObject({ description: "Fictional Corner Cafe", currency: "USD" });
    expect(mapLunchFlowTransaction(row({ description: null, merchant: null }), "9001", "CAD")).toMatchObject({ description: "Transaction", merchantName: null });
    expect(mapLunchFlowTransaction(row({ description: "x".repeat(600), merchant: "y".repeat(200) }), "9001", "CAD")).toMatchObject({ description: "x".repeat(500), merchantName: "y".repeat(120) });
  });

  it("skips pending, zero and incomplete rows", () => {
    expect(mapLunchFlowTransaction(row({ isPending: true }), "9001", "CAD")).toBeNull();
    expect(mapLunchFlowTransaction(row({ isPending: "TRUE" }), "9001", "CAD")).toBeNull();
    expect(mapLunchFlowTransaction(row({ isPending: "false" }), "9001", "CAD")).not.toBeNull();
    expect(mapLunchFlowTransaction(row({ amount: 0 }), "9001", "CAD")).toBeNull();
    expect(mapLunchFlowTransaction(row({ amount: "-0.001" }), "9001", "CAD")).toBeNull();
    expect(mapLunchFlowTransaction(row({ amount: null }), "9001", "CAD")).toBeNull();
    expect(mapLunchFlowTransaction(row({ amount: "n/a" }), "9001", "CAD")).toBeNull();
    expect(mapLunchFlowTransaction(row({ id: null }), "9001", "CAD")).toBeNull();
    expect(mapLunchFlowTransaction(row({ id: " " }), "9001", "CAD")).toBeNull();
    expect(mapLunchFlowTransaction(row({ date: "yesterday" }), "9001", "CAD")).toBeNull();
  });

  it("asks only for posted transactions in the window and keeps what is readable", async () => {
    stubFetch(
      lunchFlow({
        transactions: (id) =>
          id === "9001"
            ? [200, { transactions: [row(), row({ id: "lf-2", amount: "-87.34", date: "2026-09-26", merchant: "Fictional Grocer" }), row({ id: "lf-3", isPending: true }), { id: "lf-4", amount: { value: 1 } }, row({ id: "lf-5", date: "2026-01-01" })], total: 5 }]
            : [200, { transactions: [row({ id: "lf-9", accountId: 9002, amount: 2000, merchant: "Fictional Employer", date: "2026-09-21" })], total: 1 }],
      }),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const page = await new LunchFlowProvider().getTransactions(token(), { startDate: "2026-09-01", endDate: "2026-10-01" });
    expect(page.added.map((t) => [t.providerAccountId, t.providerTransactionId, t.amountCents])).toEqual([
      ["9001", "lf-1", -525],
      ["9001", "lf-2", -8734],
      ["9002", "lf-9", 200000],
    ]);
    expect(page).toMatchObject({ modified: [], removed: [], nextCursor: null, hasMore: false });
    const tx = requests.filter((r) => r.url.pathname.endsWith("/transactions"));
    expect(tx.map((r) => Object.fromEntries(r.url.searchParams))).toEqual([
      { from: "2026-09-01", to: "2026-10-01", include_pending: "false" },
      { from: "2026-09-01", to: "2026-10-01", include_pending: "false" },
    ]);
    // Only a count is logged: rows can hold personal data.
    expect(info).toHaveBeenCalledWith("[lunchflow] skipped 2 pending, zero or unreadable row(s)");
    info.mockRestore();
  });

  it("fetches a window again in halves when Lunch Flow says rows are missing", async () => {
    const all = [row({ id: "a", date: "2026-09-02" }), row({ id: "b", date: "2026-09-10" }), row({ id: "c", date: "2026-09-20" }), row({ id: "d", date: "2026-09-28" })];
    stubFetch(
      lunchFlow({
        accounts: [card],
        // At most two rows per answer, with the true total.
        transactions: (_id, from, to) => {
          const rows = all.filter((t) => t.date >= from && t.date <= to);
          return [200, { transactions: rows.slice(0, 2), total: rows.length }];
        },
      }),
    );
    const page = await new LunchFlowProvider().getTransactions(token(), { startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(page.added.map((t) => t.providerTransactionId).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("stops splitting when the halves hold nothing more, and drops repeats", async () => {
    stubFetch(
      lunchFlow({
        accounts: [card],
        // `total` counts something other than the rows sent (here: including pending ones).
        transactions: () => [200, { transactions: [row({ id: "a" }), row({ id: "a" })], total: 9 }],
      }),
    );
    const page = await new LunchFlowProvider().getTransactions(token(), { startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(page.added.map((t) => t.providerTransactionId)).toEqual(["a"]);
    expect(requests.filter((r) => r.url.pathname.endsWith("/transactions"))).toHaveLength(3);
  });

  it("treats an account Lunch Flow no longer has as having no transactions", async () => {
    stubFetch(lunchFlow({ accounts: [card], transactions: () => [404, { error: "Not Found" }] }));
    const page = await new LunchFlowProvider().getTransactions(token(), { startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(page.added).toEqual([]);
  });
});

describe("Lunch Flow errors", () => {
  const discover = () => new LunchFlowProvider().discover(KEY);

  it("reports a key Lunch Flow refuses, without repeating Lunch Flow's own text", async () => {
    for (const status of [401, 403]) {
      stubFetch([[status, { error: "Unauthorized", message: `<script>bad</script> ${KEY}` }]]);
      const error = await discover().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: "LOGIN_REQUIRED", message: "Lunch Flow didn't accept the API key. Create a new key in Lunch Flow and paste it into Harbour." });
      expect((error as Error).message).not.toContain(KEY);
    }
  });

  it("retries busy answers, honouring a short Retry-After", async () => {
    stubFetch([[429, {}, NO_WAIT], [503, {}, NO_WAIT], [200, { accounts: [] }]]);
    await expect(discover()).resolves.toEqual([]);
    expect(requests).toHaveLength(3);
  });

  it("gives up after three busy answers with an error the scheduler retries later", async () => {
    stubFetch([[429, {}, NO_WAIT], [429, {}, NO_WAIT], [429, {}, NO_WAIT]]);
    await expect(discover()).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    stubFetch([[503, {}, NO_WAIT], [503, {}, NO_WAIT], [503, {}, NO_WAIT]]);
    await expect(discover()).rejects.toMatchObject({ code: "INSTITUTION_UNAVAILABLE", retryable: true });
  });

  it("doesn't retry other failures", async () => {
    stubFetch([[500, {}]]);
    await expect(discover()).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    stubFetch([[400, {}]]);
    await expect(discover()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(requests).toHaveLength(2);
  });

  it("never follows a redirect with the key", async () => {
    stubFetch([[308, null, { Location: "https://elsewhere.example/api/v1/accounts" }]]);
    await expect(discover()).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: "Lunch Flow's address has changed. Update Harbour to keep syncing." });
    expect(requests).toHaveLength(1);
  });

  it("reports data it can't read instead of guessing", async () => {
    stubFetch([[200, { data: [] }]]);
    await expect(discover()).rejects.toMatchObject({ code: "UNKNOWN" });
    stubFetch([[200, { accounts: [card] }], [200, { balance: { amount: "1,234.00" } }]]);
    await expect(discover()).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("retries a network failure twice, then says Lunch Flow can't be reached", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    stubFetch([new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed")] as unknown as Answer[]);
    const result = expect(discover()).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true, message: expect.stringContaining("couldn't reach Lunch Flow") });
    await vi.runAllTimersAsync();
    await result;
    expect(requests).toHaveLength(3);
  });

  it("refuses a plain-http address in production", async () => {
    config.current = { LUNCHFLOW_API_URL: "http://lunchflow.example/api/v1", appEnv: "production" };
    const fetchMock = stubFetch([]);
    await expect(discover()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can't start a hosted sign-in: Lunch Flow is connected with a pasted key", async () => {
    const provider = new LunchFlowProvider();
    expect(provider.isConfigured()).toBe(true);
    await expect(provider.createLinkSession()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(provider.exchangePublicToken()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("Lunch Flow stored token", () => {
  it("round-trips the key, the bank connection and the accounts left out", () => {
    const stored = encodeLunchFlowToken({ key: KEY, group: "connection:501", skip: ["9002", "9001", "9002"] });
    expect(JSON.parse(stored)).toEqual({ v: 1, key: KEY, group: "connection:501", skip: ["9001", "9002"] });
    expect(decodeLunchFlowToken(stored)).toEqual({ key: KEY, group: "connection:501", skip: ["9001", "9002"] });
  });

  it("asks for the key again when the stored token is unreadable", () => {
    for (const bad of ["", "not json", "null", JSON.stringify({ v: 2, key: KEY, group: "g", skip: [] }), JSON.stringify({ v: 1, key: "", group: "g", skip: [] }), JSON.stringify({ v: 1, key: KEY })]) {
      expect(() => decodeLunchFlowToken(bad)).toThrowError(expect.objectContaining({ code: "LOGIN_REQUIRED" }));
    }
  });
});
