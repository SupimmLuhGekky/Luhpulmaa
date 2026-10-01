import { describe, expect, it } from "vitest";
import { growthSeries, isActualKind, totalsByKind } from "@/lib/goals/contributions";
import { dayNumber, fromDayNumber, timeTicks } from "@/lib/goals/timeline";

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

describe("time axis", () => {
  it("turns dates into day numbers and back", () => {
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2026-03-09") - dayNumber("2026-03-07")).toBe(2); // across the DST change
    expect(fromDayNumber(dayNumber("2028-02-29"))).toBe("2028-02-29");
  });

  it("puts long ranges on month starts with a steady rhythm", () => {
    expect(timeTicks("2026-01-15", "2026-06-20")).toEqual({ ticks: ["2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"], unit: "month" });
    // 20 months → quarterly ticks aligned to Jan/Apr/Jul/Oct, at most 5… then half-yearly
    expect(timeTicks("2025-02-10", "2026-09-30").ticks).toEqual(["2025-07-01", "2026-01-01", "2026-07-01"]);
    expect(timeTicks("2025-12-20", "2026-03-10", 4).ticks).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("spreads short ranges over evenly spaced days", () => {
    expect(timeTicks("2026-09-01", "2026-09-29")).toEqual({ ticks: ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"], unit: "day" });
    expect(timeTicks("2026-09-29", "2026-09-30").ticks).toEqual(["2026-09-29", "2026-09-30"]);
    expect(timeTicks("2026-09-30", "2026-09-30").ticks).toEqual(["2026-09-30"]);
  });
});
