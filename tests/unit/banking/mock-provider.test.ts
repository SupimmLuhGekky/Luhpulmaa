import { afterEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "@/lib/banking/providers/mock";
import { generateMockTransactions, hashString, MOCK_INSTITUTIONS, mockAccountSpecs, mockOpeningDate, prng } from "@/lib/banking/providers/mock-data";
import { ProviderError } from "@/lib/banking/types";
import { addDays, isLocalDate } from "@/lib/dates";

const TODAY = "2026-10-01";
const USER = "user-fictional-1";

async function connect(clock = TODAY, user = USER, institution = "mock_maple") {
  const provider = new MockProvider(() => clock);
  const exchange = await provider.exchangePublicToken(user, `mock-public:${institution}`);
  return { provider, exchange, token: exchange.accessToken };
}

describe("mock data generator", () => {
  const seed = hashString(`${USER}:mock_maple`);
  const anchor = mockOpeningDate(TODAY);

  it("is deterministic per seed and differs between seeds", () => {
    expect(generateMockTransactions(seed, anchor, anchor, TODAY)).toEqual(generateMockTransactions(seed, anchor, anchor, TODAY));
    expect(generateMockTransactions(seed + 1, anchor, anchor, TODAY)).not.toEqual(generateMockTransactions(seed, anchor, anchor, TODAY));
    const a = prng(42);
    const b = prng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("returns the same rows for any window (so overlapping syncs are idempotent)", () => {
    const whole = generateMockTransactions(seed, anchor, anchor, TODAY);
    const split = [...generateMockTransactions(seed, anchor, anchor, "2026-07-15"), ...generateMockTransactions(seed, anchor, "2026-07-16", TODAY)];
    expect(split).toEqual(whole);
  });

  it("never generates anything before the history start or after the end", () => {
    expect(generateMockTransactions(seed, anchor, "2020-01-01", addDays(anchor, -1))).toEqual([]);
    const rows = generateMockTransactions(seed, anchor, "2020-01-01", "2026-06-30");
    expect(rows.every((r) => r.date >= anchor && r.date <= "2026-06-30" && isLocalDate(r.date))).toBe(true);
    expect(generateMockTransactions(seed, anchor, TODAY, "2026-09-30")).toEqual([]);
  });

  it("uses integer, non-zero cents and unique ids per account", () => {
    const rows = generateMockTransactions(seed, anchor, anchor, TODAY);
    expect(rows.length).toBeGreaterThan(150);
    expect(rows.every((r) => Number.isSafeInteger(r.amountCents) && r.amountCents !== 0)).toBe(true);
    for (const key of ["chequing", "savings", "credit"] as const) {
      const ids = rows.filter((r) => r.accountKey === key).map((r) => r.id);
      expect(new Set(ids).size, key).toBe(ids.length);
    }
  });

  it("signs amounts from the account holder's point of view", () => {
    const rows = generateMockTransactions(seed, anchor, anchor, TODAY);
    const sign = (accountKey: string, description: string) => [...new Set(rows.filter((r) => r.accountKey === accountKey && r.description === description).map((r) => Math.sign(r.amountCents)))];
    expect(sign("chequing", "HARBOURFRONT GRILL PAYROLL DEP")).toEqual([1]);
    expect(sign("chequing", "ONLINE TRANSFER TO SAVINGS")).toEqual([-1]);
    expect(sign("savings", "ONLINE TRANSFER FROM CHEQUING")).toEqual([1]);
    expect(sign("savings", "INTEREST PAID")).toEqual([1]);
    expect(sign("chequing", "INTERAC E-TRANSFER RENT - LANDLORD")).toEqual([-1]);
    expect(sign("credit", "NETFLIX.COM")).toEqual([-1]);
    expect(sign("chequing", "VISA PAYMENT - CASHBACK VISA")).toEqual([-1]);
    expect(sign("credit", "PAYMENT THANK YOU / PAIEMENT MERCI")).toEqual([1]);
  });

  it("pays the card statement in full on the 26th from chequing", () => {
    const rows = generateMockTransactions(seed, anchor, anchor, TODAY);
    const payment = rows.find((r) => r.date === "2026-09-26" && r.accountKey === "credit" && r.amountCents > 0 && r.description.startsWith("PAYMENT"));
    const chequingSide = rows.find((r) => r.date === "2026-09-26" && r.accountKey === "chequing" && r.description.startsWith("VISA PAYMENT"));
    // Everything charged (net of refunds) since the previous payment day, excluding that payment itself.
    const charged = rows
      .filter((r) => r.accountKey === "credit" && r.date >= "2026-08-26" && r.date < "2026-09-26" && !r.description.startsWith("PAYMENT THANK YOU"))
      .reduce((a, r) => a - r.amountCents, 0);
    expect(charged).toBeGreaterThan(0);
    expect(payment?.amountCents).toBe(charged);
    expect(chequingSide?.amountCents).toBe(-charged);
  });

  it("pays every two weeks starting four days after the history start", () => {
    const pay = generateMockTransactions(seed, anchor, anchor, TODAY).filter((r) => r.description === "HARBOURFRONT GRILL PAYROLL DEP").map((r) => r.date);
    expect(pay[0]).toBe(addDays(anchor, 4));
    pay.slice(1).forEach((d, i) => expect(d).toBe(addDays(pay[i], 14)));
  });

  it("describes three fictional accounts and four fictional institutions", () => {
    const specs = mockAccountSpecs(seed);
    expect(specs.map((s) => [s.key, s.type])).toEqual([
      ["chequing", "CHEQUING"],
      ["savings", "SAVINGS"],
      ["credit", "CREDIT_CARD"],
    ]);
    expect(specs[2]).toMatchObject({ openingBalanceCents: 42000, creditLimitCents: 500000 });
    expect(mockAccountSpecs(seed)).toEqual(specs);
    expect(MOCK_INSTITUTIONS.every((i) => /\(Demo/.test(i.name))).toBe(true);
    expect(mockOpeningDate("2026-08-31")).toBe("2026-02-28");
  });
});

describe("MockProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exchanges a public token for a stable, per-user connection", async () => {
    const { exchange } = await connect();
    const seed = hashString(`${USER}:mock_maple`);
    expect(exchange).toEqual({
      providerItemId: `mock-item-${seed.toString(36)}`,
      accessToken: `mock:${seed}:2026-04-01:mock_maple`,
      institution: { providerInstitutionId: "mock_maple", name: "Maple Trust (Demo)", country: "CA", primaryColor: "#dc2626" },
    });
    expect((await connect()).exchange).toEqual(exchange);
    expect((await connect(TODAY, "user-fictional-2")).exchange.providerItemId).not.toBe(exchange.providerItemId);
  });

  it("fails cleanly for the always-failing institution and malformed tokens", async () => {
    const provider = new MockProvider(() => TODAY);
    const error = await provider.exchangePublicToken(USER, "mock-public:mock_error").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: "INSTITUTION_UNAVAILABLE", retryable: true });
    await expect(provider.exchangePublicToken(USER, "mock-public:unknown_bank")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(provider.exchangePublicToken(USER, "public-sandbox-123")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(provider.getAccounts("not-a-mock-token")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(provider.disconnectAccount("not-a-mock-token")).rejects.toBeInstanceOf(ProviderError);
  });

  it("reports itself as simulated and hands out mock link sessions", async () => {
    const provider = new MockProvider(() => TODAY);
    expect(provider).toMatchObject({ id: "MOCK", isSimulated: true });
    expect(provider.isConfigured()).toBe(true);
    const session = await provider.createLinkSession();
    expect(session).toMatchObject({ provider: "MOCK", mode: "mock" });
    expect(session.linkToken).toMatch(/^mock-link-[0-9a-f]{16}$/);
  });

  it("returns balances consistent with the transactions, liabilities as positive amounts owed", async () => {
    const { provider, token } = await connect();
    const accounts = await provider.getAccounts(token);
    const page = await provider.getTransactions(token, { startDate: "2026-01-01", endDate: TODAY });
    const specs = mockAccountSpecs(Number(token.split(":")[1]));
    for (const account of accounts) {
      const spec = specs.find((s) => account.providerAccountId.startsWith(`${s.key}-`))!;
      const mine = page.added.filter((t) => t.providerAccountId === account.providerAccountId);
      const posted = mine.filter((t) => !t.pending).reduce((a, t) => a + t.amountCents, 0);
      const pending = mine.filter((t) => t.pending).reduce((a, t) => a + t.amountCents, 0);
      if (account.type === "CREDIT_CARD") {
        expect(account.currentBalanceCents).toBe(spec.openingBalanceCents - posted);
        expect(account.currentBalanceCents).toBeGreaterThan(0);
        expect(account.availableBalanceCents).toBe(500000 - (account.currentBalanceCents - pending));
        expect(account.creditLimitCents).toBe(500000);
      } else {
        expect(account.currentBalanceCents).toBe(spec.openingBalanceCents + posted);
        expect(account.availableBalanceCents).toBe(account.currentBalanceCents + pending);
        expect(account.creditLimitCents).toBeNull();
      }
      expect(account.currency).toBe("CAD");
      expect(account.mask).toMatch(/^\d{4}$/);
    }
    expect(await provider.getBalances(token)).toEqual(accounts);
  });

  it("marks the last two days pending and links posted rows to their pending ids", async () => {
    const { provider, token } = await connect();
    const page = await provider.getTransactions(token, { startDate: "2026-09-01", endDate: "2026-12-31" });
    expect(page).toMatchObject({ modified: [], removed: [], nextCursor: TODAY, hasMore: false });
    expect(page.added.every((t) => t.date >= "2026-09-01" && t.date <= TODAY)).toBe(true);
    for (const t of page.added) {
      if (t.date >= "2026-09-30") {
        expect(t).toMatchObject({ pending: true, pendingTransactionId: null, postedDate: null });
        expect(t.providerTransactionId).toMatch(/^pd_mk_/);
      } else {
        expect(t.pending).toBe(false);
        expect(t.providerTransactionId).toMatch(/^mk_/);
        expect(t.pendingTransactionId).toBe(`pd_${t.providerTransactionId}`);
        expect(t.postedDate).toBe(addDays(t.date, 1));
      }
    }
  });

  it("posts yesterday's pending transactions a day later under a new id", async () => {
    const day1 = await connect(TODAY);
    const pendingRows = (await day1.provider.getTransactions(day1.token, { startDate: "2026-09-30", endDate: TODAY })).added;
    expect(pendingRows.length).toBeGreaterThan(0);
    const later = new MockProvider(() => "2026-10-03");
    const posted = (await later.getTransactions(day1.token, { startDate: "2026-09-30", endDate: TODAY })).added;
    expect(posted.map((t) => t.pendingTransactionId)).toEqual(pendingRows.map((t) => t.providerTransactionId));
    expect(posted.every((t) => !t.pending)).toBe(true);
  });

  it("falls back to MOCK_TODAY when no clock is injected", async () => {
    vi.stubEnv("MOCK_TODAY", "2026-03-31");
    const exchange = await new MockProvider().exchangePublicToken(USER, "mock-public:mock_northern");
    expect(exchange.accessToken.split(":")[2]).toBe("2025-09-30");
  });

  it("disconnects without error", async () => {
    const { provider, token } = await connect();
    await expect(provider.disconnectAccount(token)).resolves.toBeUndefined();
  });
});
