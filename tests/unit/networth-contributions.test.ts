import { describe, expect, it } from "vitest";
import {
  accountContributions,
  netWorthRangeStart,
  parseNetWorthRange,
  rebuildNetWorthHistory,
  type AccountBalanceInput,
  type BalancePoint,
  type HistoryAccount,
} from "@/lib/networth/contributions";

const base = { institution: null, isManual: false, isSimulated: false, isHidden: false, included: true };
const rows: AccountBalanceInput[] = [
  { ...base, id: "chq", name: "Chequing", type: "CHEQUING", group: "cash", side: "asset", balance: 600_000, startBalance: 500_000 },
  { ...base, id: "sav", name: "Savings", type: "SAVINGS", group: "cash", side: "asset", balance: 400_000, startBalance: null },
  { ...base, id: "rrsp", name: "RRSP", type: "INVESTMENT", group: "investments", side: "asset", balance: 1_000_000, startBalance: 900_000 },
  { ...base, id: "visa", name: "Visa", type: "CREDIT_CARD", group: "creditCards", side: "liability", balance: 50_000, startBalance: 20_000 },
  { ...base, id: "car", name: "Car loan", type: "LOAN", group: "loans", side: "liability", balance: 450_000, startBalance: 500_000 },
  { ...base, id: "old", name: "Old card", type: "CREDIT_CARD", group: "creditCards", side: "liability", balance: 9_999, startBalance: 9_999, included: false },
];

describe("accountContributions", () => {
  const r = accountContributions(rows);

  it("totals assets and liabilities from included accounts only", () => {
    expect(r.assets).toBe(2_000_000);
    expect(r.liabilities).toBe(500_000);
    expect(r.netWorth).toBe(1_500_000);
    expect(r.excluded.map((a) => a.id)).toEqual(["old"]);
  });

  it("signs contributions and changes (debts count against net worth)", () => {
    const byId = Object.fromEntries(r.groups.flatMap((g) => g.accounts).map((a) => [a.id, a]));
    expect(byId.chq).toMatchObject({ contribution: 600_000, change: 100_000, shareBps: 3_000 });
    expect(byId.visa).toMatchObject({ contribution: -50_000, change: -30_000, shareBps: 1_000 });
    expect(byId.car).toMatchObject({ contribution: -450_000, change: 50_000, shareBps: 9_000 });
    expect(byId.sav.change).toBeNull();
  });

  it("groups accounts in display order with shares and known changes", () => {
    expect(r.groups.map((g) => [g.key, g.total, g.shareBps])).toEqual([
      ["cash", 1_000_000, 5_000],
      ["investments", 1_000_000, 5_000],
      ["creditCards", 50_000, 1_000],
      ["loans", 450_000, 9_000],
    ]);
    const cash = r.groups.find((g) => g.key === "cash")!;
    expect(cash.accounts.map((a) => a.id)).toEqual(["chq", "sav"]);
    expect(cash.change).toBe(100_000);
  });

  it("handles no accounts", () => {
    expect(accountContributions([])).toMatchObject({ assets: 0, liabilities: 0, netWorth: 0, groups: [], excluded: [] });
  });
});

describe("net worth ranges", () => {
  it("resolves range starts", () => {
    expect(netWorthRangeStart("1m", "2026-09-30")).toBe("2026-08-30");
    expect(netWorthRangeStart("6m", "2026-09-30")).toBe("2026-03-30");
    expect(netWorthRangeStart("ytd", "2026-09-30")).toBe("2026-01-01");
    expect(netWorthRangeStart("1y", "2026-09-30")).toBe("2025-09-30");
    expect(netWorthRangeStart("all", "2026-09-30")).toBeNull();
  });

  it("parses the range parameter", () => {
    expect(parseNetWorthRange("1y")).toBe("1y");
    expect(parseNetWorthRange("5y")).toBe("6m");
    expect(parseNetWorthRange(undefined, "all")).toBe("all");
  });
});

describe("rebuildNetWorthHistory", () => {
  const accounts: HistoryAccount[] = [
    { id: "chq", side: "asset", closed: false },
    { id: "visa", side: "liability", closed: false },
    { id: "rrsp", side: "asset", closed: false },
    { id: "old", side: "asset", closed: true },
  ];
  // Deliberately out of order; "gone" belongs to an account that no longer counts.
  const points: BalancePoint[] = [
    { accountId: "rrsp", date: "2026-09-03", balance: 5_000 },
    { accountId: "chq", date: "2026-09-02", balance: 1_500 },
    { accountId: "old", date: "2026-09-02", balance: 100 },
    { accountId: "chq", date: "2026-08-28", balance: 1_000 },
    { accountId: "visa", date: "2026-09-01", balance: 200 },
    { accountId: "old", date: "2026-08-30", balance: 300 },
    { accountId: "gone", date: "2026-08-01", balance: 999_999 },
  ];

  it("carries each balance forward, backfills later accounts and drops closed ones after their last balance", () => {
    const { history } = rebuildNetWorthHistory(accounts, points, "2026-09-01", "2026-09-04");
    expect(history).toEqual([
      // chq seeded from before the range, rrsp backfilled at its first balance, old still open
      { date: "2026-09-01", assets: 6_300, liabilities: 200, netWorth: 6_100 },
      { date: "2026-09-02", assets: 6_600, liabilities: 200, netWorth: 6_400 },
      // old was closed after its last balance on Sep 2
      { date: "2026-09-03", assets: 6_500, liabilities: 200, netWorth: 6_300 },
      { date: "2026-09-04", assets: 6_500, liabilities: 200, netWorth: 6_300 },
    ]);
  });

  it("returns each account's balance on the first day", () => {
    const { startBalances } = rebuildNetWorthHistory(accounts, points, "2026-09-01", "2026-09-04");
    expect(Object.fromEntries(startBalances)).toEqual({ chq: 1_000, visa: 200, rrsp: 5_000, old: 300 });
  });

  it("starts on the first known balance when the range starts earlier", () => {
    const { history } = rebuildNetWorthHistory(accounts, points, "2026-08-01", "2026-08-29");
    expect(history.map((p) => p.date)).toEqual(["2026-08-28", "2026-08-29"]);
    expect(history[0]).toEqual({ date: "2026-08-28", assets: 6_300, liabilities: 200, netWorth: 6_100 });
  });

  it("is empty without balances, accounts or days", () => {
    expect(rebuildNetWorthHistory([], points, "2026-09-01", "2026-09-04").history).toEqual([]);
    expect(rebuildNetWorthHistory(accounts, [], "2026-09-01", "2026-09-04").history).toEqual([]);
    expect(rebuildNetWorthHistory(accounts, points, "2026-09-04", "2026-09-01").history).toEqual([]);
    expect(rebuildNetWorthHistory(accounts, points, "2026-08-01", "2026-08-15").history).toEqual([]);
  });
});
