import { describe, expect, it } from "vitest";
import { budgetHref, parsePeriodParams, periodLabel, periodTiming, shiftPeriod } from "@/lib/budget/periods";
import { crossedThreshold, nextThreshold, normalizeThresholds } from "@/lib/budget/thresholds";

describe("parsePeriodParams", () => {
  const today = "2026-09-30";

  it("defaults to the current month", () => {
    expect(parsePeriodParams({}, today)).toEqual({ period: "MONTHLY", start: "2026-09-01", end: "2026-09-30", id: null });
  });

  it("reads a month and ignores invalid ones", () => {
    expect(parsePeriodParams({ month: "2026-02" }, today)).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
    expect(parsePeriodParams({ month: "2026-13" }, today)).toMatchObject({ start: "2026-09-01" });
    expect(parsePeriodParams({ month: ["2025-12", "2026-01"] }, today)).toMatchObject({ start: "2025-12-01", end: "2025-12-31" });
  });

  it("snaps a weekly date to the start of the user's week", () => {
    // 2026-09-30 is a Wednesday.
    expect(parsePeriodParams({ period: "weekly" }, today, 0)).toMatchObject({ period: "WEEKLY", start: "2026-09-27", end: "2026-10-03" });
    expect(parsePeriodParams({ period: "weekly", week: "2026-10-05" }, today, 1)).toMatchObject({ start: "2026-10-05", end: "2026-10-11" });
    expect(parsePeriodParams({ period: "weekly", week: "nope" }, today, 1)).toMatchObject({ start: "2026-09-28" });
  });

  it("accepts only a uuid for custom budgets", () => {
    expect(parsePeriodParams({ period: "custom", id: "7d1b2c3e-1111-4a2b-8c3d-123456789abc" }, today).id).toBe("7d1b2c3e-1111-4a2b-8c3d-123456789abc");
    expect(parsePeriodParams({ period: "custom", id: "'; drop table" }, today)).toEqual({ period: "CUSTOM", start: null, end: null, id: null });
  });
});

describe("shiftPeriod", () => {
  it("moves months, including across years and short months", () => {
    expect(shiftPeriod("MONTHLY", "2026-01-01", -1)).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(shiftPeriod("MONTHLY", "2026-01-01", 1)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("moves weeks", () => {
    expect(shiftPeriod("WEEKLY", "2026-09-27", 1)).toEqual({ start: "2026-10-04", end: "2026-10-10" });
    expect(shiftPeriod("WEEKLY", "2026-09-28", -1, 1)).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  });
});

describe("budgetHref", () => {
  it("builds links that parsePeriodParams reads back", () => {
    expect(budgetHref({ period: "MONTHLY", start: "2026-08-01" })).toBe("/budget?month=2026-08");
    expect(budgetHref({ period: "WEEKLY", start: "2026-09-27" })).toBe("/budget?period=weekly&week=2026-09-27");
    expect(budgetHref({ period: "CUSTOM", id: "abc" }, { new: "1" })).toBe("/budget?period=custom&id=abc&new=1");
    const href = budgetHref({ period: "WEEKLY", start: "2026-09-27" });
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parsePeriodParams(params, "2026-01-01")).toMatchObject({ period: "WEEKLY", start: "2026-09-27" });
  });
});

describe("periodLabel and periodTiming", () => {
  it("labels periods", () => {
    expect(periodLabel("MONTHLY", "2026-09-01", "2026-09-30")).toBe("September 2026");
    expect(periodLabel("WEEKLY", "2026-09-27", "2026-10-03")).toBe("Week of Sep 27, 2026");
    expect(periodLabel("CUSTOM", "2026-09-01", "2026-09-14")).toBe("Sep 1 – Sep 14, 2026");
    expect(periodLabel("CUSTOM", "2026-12-20", "2027-01-05")).toBe("Dec 20, 2026 – Jan 5, 2027");
  });

  it("tells past, current and future periods apart", () => {
    expect(periodTiming("2026-09-01", "2026-09-30", "2026-09-30")).toBe("current");
    expect(periodTiming("2026-08-01", "2026-08-31", "2026-09-30")).toBe("past");
    expect(periodTiming("2026-10-01", "2026-10-31", "2026-09-30")).toBe("future");
  });
});

describe("thresholds", () => {
  it("normalizes to unique sorted whole percents, at most six", () => {
    expect(normalizeThresholds([100, 80, 80, 0, 250, 12.5, 50])).toEqual([50, 80, 100]);
    expect(normalizeThresholds([1, 2, 3, 4, 5, 6, 7])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("fires thresholds below 100% when reached and 100%+ only when exceeded", () => {
    expect(crossedThreshold(7999, [80, 100])).toBeNull();
    expect(crossedThreshold(8000, [80, 100])).toBe(80);
    expect(crossedThreshold(10000, [80, 100])).toBe(80);
    expect(crossedThreshold(10001, [80, 100])).toBe(100);
    expect(crossedThreshold(12500, [50, 75, 120])).toBe(120);
    expect(crossedThreshold(5000, [])).toBeNull();
  });

  it("finds the next alert ahead", () => {
    expect(nextThreshold(0, [80, 100])).toBe(80);
    expect(nextThreshold(8500, [50, 80, 100])).toBe(100);
    expect(nextThreshold(10500, [80, 100])).toBeNull();
  });
});
