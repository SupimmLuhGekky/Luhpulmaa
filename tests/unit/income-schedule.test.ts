import { describe, expect, it } from "vitest";
import { nextPayday, paydaysBetween, type PayScheduleSource } from "@/lib/income/schedule";

const source = (over: Partial<PayScheduleSource> = {}): PayScheduleSource => ({
  id: "s1",
  name: "Salary",
  frequency: "BIWEEKLY",
  averageAmountCents: 200_000,
  lastPaidDate: "2026-10-01",
  nextExpectedDate: "2026-10-15",
  semiMonthlyDays: [],
  ...over,
});

describe("paydaysBetween", () => {
  it("lists expected paydays from the anchor", () => {
    expect(paydaysBetween(source(), "2026-10-02", "2026-11-15").map((p) => p.date)).toEqual(["2026-10-15", "2026-10-29", "2026-11-12"]);
  });

  it("never repeats the last payday", () => {
    expect(paydaysBetween(source({ nextExpectedDate: null }), "2026-10-01", "2026-10-20").map((p) => p.date)).toEqual(["2026-10-15"]);
  });

  it("doesn't count a paycheque twice when it arrives a few days early", () => {
    // Expected Oct 15, arrived Oct 13; the expected date was covered.
    const early = source({ lastPaidDate: "2026-10-13", nextExpectedDate: "2026-10-15" });
    expect(paydaysBetween(early, "2026-10-13", "2026-11-01").map((p) => p.date)).toEqual(["2026-10-29"]);
    expect(nextPayday(early, "2026-10-14")).toBe("2026-10-29");
  });

  it("keeps the next payday of a weekly schedule", () => {
    const weekly = source({ frequency: "WEEKLY", lastPaidDate: "2026-10-01", nextExpectedDate: "2026-10-08" });
    expect(paydaysBetween(weekly, "2026-10-02", "2026-10-16").map((p) => p.date)).toEqual(["2026-10-08", "2026-10-15"]);
  });

  it("returns nothing without an anchor or for a reversed range", () => {
    expect(paydaysBetween(source({ lastPaidDate: null, nextExpectedDate: null }), "2026-10-01", "2026-12-01")).toEqual([]);
    expect(paydaysBetween(source(), "2026-12-01", "2026-10-01")).toEqual([]);
  });
});
