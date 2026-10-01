import { describe, expect, it } from "vitest";
import { growthSeries, isActualKind, totalsByKind } from "@/lib/goals/contributions";

describe("planned vs actual", () => {
  it("only planned allocations count as planned", () => {
    expect(isActualKind("PLANNED_ALLOCATION")).toBe(false);
    expect(isActualKind("USER_REPORTED_TRANSFER")).toBe(true);
    expect(isActualKind("PROVIDER_TRANSFER")).toBe(true);
  });

  it("totals each kind separately, withdrawals included", () => {
    expect(
      totalsByKind([
        { amount: 25_000, kind: "USER_REPORTED_TRANSFER" },
        { amount: 18_700, kind: "PLANNED_ALLOCATION" },
        { amount: -5_000, kind: "USER_REPORTED_TRANSFER" },
        { amount: 124, kind: "PLANNED_ALLOCATION" },
      ]),
    ).toEqual({ actual: 20_000, planned: 18_824, total: 38_824 });
    expect(totalsByKind([])).toEqual({ actual: 0, planned: 0, total: 0 });
  });
});

describe("growthSeries", () => {
  const contributions = [
    { date: "2026-09-04", amount: 18_700, kind: "PLANNED_ALLOCATION" as const },
    { date: "2026-08-21", amount: 25_000, kind: "USER_REPORTED_TRANSFER" as const },
    { date: "2026-09-04", amount: 25_000, kind: "USER_REPORTED_TRANSFER" as const },
    { date: "2026-09-04", amount: 50, kind: "PLANNED_ALLOCATION" as const },
  ];

  it("keeps running totals per kind, one point per day, oldest first", () => {
    expect(growthSeries(contributions)).toEqual([
      { date: "2026-08-21", actual: 25_000, planned: 0, total: 25_000 },
      { date: "2026-09-04", actual: 50_000, planned: 18_750, total: 68_750 },
    ]);
  });

  it("starts at zero the day before the first contribution and extends to today", () => {
    const s = growthSeries(contributions, { startAt: "2026-09-30", extendTo: "2026-09-30" });
    expect(s[0]).toEqual({ date: "2026-08-20", actual: 0, planned: 0, total: 0 });
    expect(s.at(-1)).toEqual({ date: "2026-09-30", actual: 50_000, planned: 18_750, total: 68_750 });
    expect(s).toHaveLength(4);
  });

  it("starts on the creation day when that came first", () => {
    expect(growthSeries(contributions, { startAt: "2026-08-01" })[0].date).toBe("2026-08-01");
  });

  it("draws a flat zero line for a goal without contributions", () => {
    expect(growthSeries([], { startAt: "2026-09-01", extendTo: "2026-09-30" })).toEqual([
      { date: "2026-09-01", actual: 0, planned: 0, total: 0 },
      { date: "2026-09-30", actual: 0, planned: 0, total: 0 },
    ]);
    expect(growthSeries([])).toEqual([]);
  });
});
