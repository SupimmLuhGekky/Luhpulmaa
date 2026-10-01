import { describe, expect, it } from "vitest";
import { accountContributions, netWorthRangeStart, parseNetWorthRange, type AccountBalanceInput } from "@/lib/networth/contributions";

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
