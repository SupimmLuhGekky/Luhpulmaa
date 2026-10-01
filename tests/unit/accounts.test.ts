import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { ProviderError } from "@/lib/banking/types";
import { syncRateLimitMessage, toAccountsError, withProviderErrors } from "@/lib/accounts/errors";
import { accountUpdateSchema, connectSchema, manualAccountSchema } from "@/lib/accounts/schemas";
import { connectionState, creditUtilization, dailyBalanceSeries, downsample, groupAccounts, historyRangeStart, relativeTimeAgo, utilizationTone } from "@/lib/accounts/summary";
import { groupOf, hasCreditLimit, manualAvailableBalance } from "@/lib/accounts/types";

type Acc = { id: string; type: Parameters<typeof groupOf>[0]; currency: string; currentBalanceCents: number; isHidden: boolean; institution?: { id: string } | null };
const acc = (id: string, type: Acc["type"], cents: number, extra: Partial<Acc> = {}): Acc => ({ id, type, currency: "CAD", currentBalanceCents: cents, isHidden: false, ...extra });

describe("groupAccounts", () => {
  const accounts = [
    acc("visa", "CREDIT_CARD", 42_000),
    acc("chq", "CHEQUING", 437_453),
    acc("loan", "LOAN", 890_000),
    acc("sav", "SAVINGS", 937_082),
    acc("old", "CHEQUING", 5_000, { isHidden: true }),
    acc("rrsp", "INVESTMENT", 1_240_000),
    acc("art", "OTHER_ASSET", 300_000),
    acc("iou", "OTHER_LIABILITY", 50_000),
  ];

  it("orders groups cash → credit → loans → investments → other and keeps account order", () => {
    const groups = groupAccounts(accounts);
    expect(groups.map((g) => g.key)).toEqual(["cash", "credit", "loans", "investments", "other"]);
    expect(groups[0].accounts.map((a) => a.id)).toEqual(["chq", "sav"]);
  });

  it("leaves hidden accounts out unless asked", () => {
    expect(groupAccounts(accounts)[0].accounts).toHaveLength(2);
    expect(groupAccounts(accounts, { includeHidden: true })[0].accounts.map((a) => a.id)).toEqual(["chq", "sav", "old"]);
  });

  it("totals assets as held, debts as owed and mixed groups as a net amount", () => {
    const [cash, credit, loans, , other] = groupAccounts(accounts);
    expect(cash).toMatchObject({ kind: "asset", totals: [{ currency: "CAD", cents: 1_374_535 }] });
    expect(credit).toMatchObject({ kind: "liability", totals: [{ currency: "CAD", cents: 42_000 }] });
    expect(loans).toMatchObject({ kind: "liability", totals: [{ currency: "CAD", cents: 890_000 }] });
    expect(other).toMatchObject({ kind: "mixed", totals: [{ currency: "CAD", cents: 250_000 }] });
  });

  it("never adds different currencies together and lists the user's currency first", () => {
    const groups = groupAccounts([acc("us", "CHEQUING", 10_000, { currency: "USD" }), acc("eu", "SAVINGS", 7_000, { currency: "EUR" }), acc("ca", "CHEQUING", 25_000)], { baseCurrency: "CAD" });
    expect(groups[0].totals).toEqual([
      { currency: "CAD", cents: 25_000 },
      { currency: "EUR", cents: 7_000 },
      { currency: "USD", cents: 10_000 },
    ]);
  });

  it("keeps accounts from the same institution together inside a group", () => {
    const maple = { id: "maple" };
    const laurentide = { id: "laurentide" };
    const groups = groupAccounts([
      acc("m-chq", "CHEQUING", 1, { institution: maple }),
      acc("l-chq", "CHEQUING", 1, { institution: laurentide }),
      acc("cash", "CASH", 1),
      acc("m-sav", "SAVINGS", 1, { institution: maple }),
      acc("l-sav", "SAVINGS", 1, { institution: laurentide }),
      acc("m-visa", "CREDIT_CARD", 1, { institution: maple }),
    ]);
    expect(groups[0].accounts.map((a) => a.id)).toEqual(["m-chq", "m-sav", "l-chq", "l-sav", "cash"]);
    expect(groups[1].accounts.map((a) => a.id)).toEqual(["m-visa"]);
  });

  it("drops empty groups", () => {
    expect(groupAccounts([acc("chq", "CHEQUING", 1)]).map((g) => g.key)).toEqual(["cash"]);
    expect(groupAccounts([])).toEqual([]);
  });
});

describe("credit utilization", () => {
  it("is computed only for cards and lines of credit with a limit", () => {
    expect(creditUtilization({ type: "CREDIT_CARD", currentBalanceCents: 125_000, creditLimitCents: 500_000 })).toEqual({ limit: 500_000, used: 125_000, available: 375_000, usedBps: 2500, tone: "primary" });
    expect(creditUtilization({ type: "CREDIT_CARD", currentBalanceCents: 125_000, creditLimitCents: null })).toBeNull();
    expect(creditUtilization({ type: "CREDIT_CARD", currentBalanceCents: 125_000, creditLimitCents: 0 })).toBeNull();
    expect(creditUtilization({ type: "LOAN", currentBalanceCents: 125_000, creditLimitCents: 500_000 })).toBeNull();
  });

  it("treats a credit balance as nothing used and can exceed 100%", () => {
    expect(creditUtilization({ type: "CREDIT_CARD", currentBalanceCents: -2_500, creditLimitCents: 100_000 })).toMatchObject({ used: 0, available: 102_500, usedBps: 0 });
    expect(creditUtilization({ type: "LINE_OF_CREDIT", currentBalanceCents: 110_000, creditLimitCents: 100_000 })).toMatchObject({ usedBps: 11_000, available: -10_000, tone: "danger" });
  });

  it("rounds exactly and picks a tone by threshold", () => {
    expect(creditUtilization({ type: "CREDIT_CARD", currentBalanceCents: 1, creditLimitCents: 3 })?.usedBps).toBe(3333);
    expect([0, 2999, 3000, 7499, 7500].map(utilizationTone)).toEqual(["primary", "primary", "warning", "warning", "danger"]);
  });
});

describe("dailyBalanceSeries", () => {
  const history = [
    { date: "2026-09-01", balance: 100 },
    { date: "2026-09-03", balance: 300 },
    { date: "2026-09-06", balance: 600 },
  ];

  it("carries each snapshot forward to the next one", () => {
    expect(dailyBalanceSeries(history, "2026-09-01", "2026-09-06").map((p) => p.balance)).toEqual([100, 100, 300, 300, 300, 600]);
  });

  it("starts from the balance in effect on the first day of the range", () => {
    expect(dailyBalanceSeries(history, "2026-09-04", "2026-09-07")).toEqual([
      { date: "2026-09-04", balance: 300 },
      { date: "2026-09-05", balance: 300 },
      { date: "2026-09-06", balance: 600 },
      { date: "2026-09-07", balance: 600 },
    ]);
  });

  it("starts at the first snapshot when history is shorter than the range", () => {
    expect(dailyBalanceSeries(history, "2026-08-01", "2026-09-02")).toEqual([
      { date: "2026-09-01", balance: 100 },
      { date: "2026-09-02", balance: 100 },
    ]);
  });

  it("ignores later snapshots, accepts unsorted input and handles no history", () => {
    expect(dailyBalanceSeries([...history].reverse(), "2026-09-02", "2026-09-03").map((p) => p.balance)).toEqual([100, 300]);
    expect(dailyBalanceSeries([], "2026-09-01", "2026-09-30")).toEqual([]);
    expect(dailyBalanceSeries([{ date: "2026-10-01", balance: 5 }], "2026-09-01", "2026-09-30")).toEqual([]);
  });

  it("crosses month and leap-year boundaries one calendar day at a time", () => {
    const series = dailyBalanceSeries([{ date: "2028-02-27", balance: 1 }], "2028-02-27", "2028-03-01");
    expect(series.map((p) => p.date)).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("downsamples long series but keeps both ends", () => {
    const points = Array.from({ length: 366 }, (_, i) => i);
    const sampled = downsample(points, 120);
    expect(sampled).toHaveLength(120);
    expect(sampled[0]).toBe(0);
    expect(sampled[119]).toBe(365);
    expect(sampled).toEqual([...sampled].sort((a, b) => a - b));
    expect(downsample([1, 2, 3], 120)).toEqual([1, 2, 3]);
  });

  it("derives range starts from calendar months", () => {
    expect(historyRangeStart("2026-10-01", "1m")).toBe("2026-09-01");
    expect(historyRangeStart("2026-03-31", "1m")).toBe("2026-02-28");
    expect(historyRangeStart("2026-10-01", "1y")).toBe("2025-10-01");
  });
});

describe("relativeTimeAgo", () => {
  const now = "2026-10-01T12:00:00.000Z";
  it("describes recent instants in words", () => {
    expect(relativeTimeAgo("2026-10-01T11:59:30.000Z", now)).toBe("just now");
    expect(relativeTimeAgo("2026-10-01T11:55:00.000Z", now)).toBe("5 minutes ago");
    expect(relativeTimeAgo("2026-10-01T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(relativeTimeAgo("2026-09-30T11:00:00.000Z", now)).toBe("yesterday");
    expect(relativeTimeAgo("2026-09-27T12:00:00.000Z", now)).toBe("4 days ago");
  });
  it("gives up after a month so callers can show a date", () => {
    expect(relativeTimeAgo("2026-08-01T12:00:00.000Z", now)).toBeNull();
    expect(relativeTimeAgo("not a date", now)).toBeNull();
  });
});

describe("connectionState", () => {
  it("offers the right actions per status", () => {
    expect(connectionState("ACTIVE")).toMatchObject({ canSync: true, needsReconnect: false, tone: "positive" });
    expect(connectionState("REQUIRES_REAUTH")).toMatchObject({ canSync: false, needsReconnect: true, tone: "warning" });
    expect(connectionState("ERROR")).toMatchObject({ canSync: true, needsReconnect: true, tone: "danger" });
    expect(connectionState("DISCONNECTED")).toMatchObject({ canSync: false, needsReconnect: true, tone: "neutral" });
  });
});

describe("account types", () => {
  it("groups other assets and other debts together", () => {
    expect(groupOf("OTHER_LIABILITY")).toBe("other");
    expect(groupOf("MORTGAGE")).toBe("loans");
    expect(groupOf("LINE_OF_CREDIT")).toBe("credit");
  });

  it("stores available credit for manual cards with a limit, the balance otherwise", () => {
    expect(hasCreditLimit("LINE_OF_CREDIT")).toBe(true);
    expect(manualAvailableBalance("CREDIT_CARD", 120_000, 500_000)).toBe(380_000);
    expect(manualAvailableBalance("CREDIT_CARD", 120_000, null)).toBe(120_000);
    expect(manualAvailableBalance("LOAN", 890_000, 1_000_000)).toBe(890_000);
    expect(manualAvailableBalance("CHEQUING", -5_000, undefined)).toBe(-5_000);
  });
});

describe("schemas", () => {
  it("validates a manual account with friendly messages", () => {
    expect(manualAccountSchema.parse({ name: " Neo card ", type: "CREDIT_CARD", balanceCents: 12_345, creditLimitCents: 300_000, mask: "1234" })).toMatchObject({ name: "Neo card", currency: "CAD" });
    const bad = manualAccountSchema.safeParse({ name: "", type: "CHEQUING", balanceCents: 1.5, mask: "12345" });
    expect(bad.success).toBe(false);
    const fields = bad.success ? {} : bad.error.flatten().fieldErrors;
    expect(fields.name).toEqual(["Give the account a name"]);
    expect(fields.mask).toEqual(["Use up to 4 digits"]);
    expect(fields.balanceCents).toBeDefined();
    expect(manualAccountSchema.safeParse({ name: "x", type: "CHEQUING" }).error?.flatten().fieldErrors.balanceCents).toEqual(["Enter the balance"]);
  });

  it("bounds balance updates and allows clearing a credit limit", () => {
    expect(accountUpdateSchema.safeParse({ balanceCents: 100_000_000_01 }).success).toBe(false);
    expect(accountUpdateSchema.parse({ creditLimitCents: null })).toEqual({ creditLimitCents: null });
  });

  it("keeps only the institution from widget metadata", () => {
    const parsed = connectSchema.parse({ publicToken: "public-sandbox-1", metadata: { institution: { name: "Neo", institution_id: "ins_1", extra: "x" }, accounts: [{ id: 1 }] } });
    expect(parsed.metadata).toEqual({ institution: { name: "Neo", institution_id: "ins_1" } });
    expect(connectSchema.parse({ publicToken: "8b35f6c8-e7b6-41d3-98f8-08d68b7f8d31", metadata: { institution: "Neo Financial" } }).metadata).toEqual({ institution: "Neo Financial" });
    expect(connectSchema.safeParse({ publicToken: "" }).success).toBe(false);
  });
});

describe("provider errors", () => {
  it("become safe AppErrors that keep the provider's user-facing message", () => {
    const err = toAccountsError(new ProviderError("INSTITUTION_UNAVAILABLE", "This institution is not responding right now.", true));
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: "This institution is not responding right now." });
    expect(toAccountsError(new ProviderError("NOT_CONFIGURED", "Off"))).toMatchObject({ code: "FEATURE_DISABLED" });
    expect(toAccountsError(new ProviderError("LOGIN_REQUIRED", "Sign in again"))).toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("leave other errors untouched", async () => {
    const other = new Error("boom");
    expect(toAccountsError(other)).toBe(other);
    await expect(withProviderErrors(async () => 42)).resolves.toBe(42);
    await expect(withProviderErrors(async () => Promise.reject(new ProviderError("RATE_LIMITED", "Busy", true)))).rejects.toMatchObject({ code: "RATE_LIMITED", message: "Busy" });
  });

  it("explains the sync rate limit in minutes", () => {
    expect(syncRateLimitMessage(30)).toContain("in a minute");
    expect(syncRateLimitMessage(1_500)).toContain("about 25 minutes");
  });
});
