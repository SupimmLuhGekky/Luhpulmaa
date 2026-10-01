import { describe, expect, it } from "vitest";
import { analyticsQuerySchema, bucketFor, fillSeries, resolveRange } from "@/lib/analytics/range";

const ID_A = "0b6f3c5e-8a1d-4f2b-9c3e-1a2b3c4d5e6f";
const ID_B = "1c7a4d6f-9b2e-4a3c-8d4f-2b3c4d5e6f70";

describe("resolveRange", () => {
  it("compares month-to-date with the same days last month", () => {
    expect(resolveRange({ range: "month" }, "2026-09-30")).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
      previousFrom: "2026-08-01",
      previousTo: "2026-08-30",
      label: "This month",
      periodPhrase: "this month",
      comparisonLabel: "the same days last month",
    });
  });

  it("clamps the previous month to its last day", () => {
    expect(resolveRange({ range: "month" }, "2026-03-31")).toMatchObject({ previousFrom: "2026-02-01", previousTo: "2026-02-28" });
  });

  it("compares week-to-date with the same days last week, honouring the week start", () => {
    // 2026-09-30 is a Wednesday.
    expect(resolveRange({ range: "week" }, "2026-09-30", 0)).toMatchObject({ from: "2026-09-27", to: "2026-09-30", previousFrom: "2026-09-20", previousTo: "2026-09-23" });
    expect(resolveRange({ range: "week" }, "2026-09-30", 1)).toMatchObject({ from: "2026-09-28", previousFrom: "2026-09-21", previousTo: "2026-09-23" });
  });

  it("compares quarter- and year-to-date with the same stretch one period earlier", () => {
    expect(resolveRange({ range: "quarter" }, "2026-08-31")).toMatchObject({ from: "2026-07-01", previousFrom: "2026-04-01", previousTo: "2026-05-31" });
    expect(resolveRange({ range: "quarter" }, "2026-09-30")).toMatchObject({ previousTo: "2026-06-30" });
    expect(resolveRange({ range: "year" }, "2028-02-29")).toMatchObject({ from: "2028-01-01", previousFrom: "2027-01-01", previousTo: "2027-02-28", comparisonLabel: "the same period last year" });
  });

  it("compares a custom range with the equally long stretch before it", () => {
    expect(resolveRange({ range: "custom", from: "2026-09-01", to: "2026-09-14" }, "2026-09-30")).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-14",
      previousFrom: "2026-08-18",
      previousTo: "2026-08-31",
      periodPhrase: "in this period",
      comparisonLabel: "the previous 14 days",
    });
  });

  it("swaps a reversed custom range instead of producing an empty one", () => {
    const r = resolveRange({ range: "custom", from: "2026-10-05", to: "2026-09-20" }, "2026-09-30");
    expect(r).toMatchObject({ from: "2026-09-20", to: "2026-10-05" });
    // A start in the future with no end used to give a zero-day range (and a division by zero).
    expect(resolveRange({ range: "custom", from: "2026-10-03" }, "2026-09-30")).toMatchObject({ from: "2026-09-30", to: "2026-10-03" });
  });

  it("defaults a custom range to the last 30 days", () => {
    expect(resolveRange({ range: "custom" }, "2026-09-30")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", comparisonLabel: "the previous 30 days" });
    expect(resolveRange({ range: "custom", from: "2026-09-30", to: "2026-09-30" }, "2026-09-30").comparisonLabel).toBe("the day before");
  });
});

describe("analyticsQuerySchema", () => {
  it("reads comma-separated account and category ids from a query string", () => {
    const q = analyticsQuerySchema.parse({ range: "quarter", accounts: `${ID_A}, ${ID_B}`, categories: ID_A });
    expect(q).toEqual({ range: "quarter", accounts: [ID_A, ID_B], categories: [ID_A] });
  });

  it("treats empty filters as no filter and defaults to this month", () => {
    expect(analyticsQuerySchema.parse({ accounts: "" })).toEqual({ range: "month", accounts: [] });
  });

  it("rejects malformed ids and impossible dates", () => {
    expect(analyticsQuerySchema.safeParse({ accounts: "not-a-uuid" }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ range: "custom", from: "2026-02-30" }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ range: "decade" }).success).toBe(false);
  });
});

describe("bucketFor", () => {
  it("uses days up to a month, weeks up to ~4 months, then months", () => {
    expect(bucketFor(31)).toBe("day");
    expect(bucketFor(32)).toBe("week");
    expect(bucketFor(120)).toBe("week");
    expect(bucketFor(121)).toBe("month");
  });
});

describe("fillSeries", () => {
  it("adds zero days so the time axis stays even", () => {
    const out = fillSeries([{ period: "2026-09-02", income: 0, spending: 500 }], "2026-09-01", "2026-09-04", "day");
    expect(out).toEqual([
      { period: "2026-09-01", income: 0, spending: 0 },
      { period: "2026-09-02", income: 0, spending: 500 },
      { period: "2026-09-03", income: 0, spending: 0 },
      { period: "2026-09-04", income: 0, spending: 0 },
    ]);
  });

  it("uses Monday-based weeks like the SQL buckets", () => {
    // 2026-07-01 is a Wednesday: its bucket starts on Monday 2026-06-29.
    const out = fillSeries([{ period: "2026-07-06", income: 100, spending: 0 }], "2026-07-01", "2026-07-20", "week");
    expect(out.map((r) => r.period)).toEqual(["2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20"]);
    expect(out[1].income).toBe(100);
  });

  it("fills months", () => {
    const out = fillSeries([], "2026-01-15", "2026-03-02", "month");
    expect(out.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});
