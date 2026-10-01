import { describe, expect, it } from "vitest";
import { previewAllocation } from "@/lib/income/allocation";
import { nextPayday, paydaysBetween, type PayScheduleSource } from "@/lib/income/schedule";
import { dayOfMonthLabel, scheduleLabel } from "@/components/income/labels";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("previewAllocation", () => {
  it("splits a paycheque by percentages and leaves the rest unallocated", () => {
    const p = previewAllocation(250_000, [
      { label: "Needs", method: "PERCENT", percentBps: 5000 },
      { label: "Savings", method: "PERCENT", percentBps: 2000, goalId: "g1" },
    ]);
    expect(p.lines.map((l) => l.amount)).toEqual([125_000, 50_000]);
    expect(p.unallocated).toBe(75_000);
    expect(p.totalPercentBps).toBe(7000);
    expect(p.shortfall).toBe(0);
    expect(p.overAllocated).toBe(false);
    expect(p.lines[1].goalId).toBe("g1");
  });

  it("takes fixed amounts first, then percentages of the whole paycheque", () => {
    const p = previewAllocation(100_000, [
      { label: "Rent share", method: "FIXED", amountCents: 40_000 },
      { label: "Car Fund", method: "PERCENT", percentBps: 1000 },
    ]);
    expect(p.lines.map((l) => l.amount)).toEqual([40_000, 10_000]);
    expect(p.unallocated).toBe(50_000);
  });

  it("scales percentages down when fixed lines leave too little, and reports the shortfall", () => {
    const p = previewAllocation(100_000, [
      { label: "Fixed", method: "FIXED", amountCents: 70_000 },
      { label: "A", method: "PERCENT", percentBps: 3000 },
      { label: "B", method: "PERCENT", percentBps: 1000 },
    ]);
    // 30,000 left for 40,000 of requested percentages → 3:1 split of 30,000.
    expect(p.lines.map((l) => l.amount)).toEqual([70_000, 22_500, 7_500]);
    expect(p.lines.map((l) => l.requested)).toEqual([70_000, 30_000, 10_000]);
    expect(p.unallocated).toBe(0);
    expect(p.shortfall).toBe(10_000);
    expect(p.overAllocated).toBe(true);
  });

  it("caps fixed lines at what is left, in order", () => {
    const p = previewAllocation(50_000, [
      { label: "First", method: "FIXED", amountCents: 40_000 },
      { label: "Second", method: "FIXED", amountCents: 40_000 },
    ]);
    expect(p.lines.map((l) => l.amount)).toEqual([40_000, 10_000]);
    expect(p.shortfall).toBe(30_000);
    expect(p.overAllocated).toBe(true);
  });

  it("flags percentages above 100%", () => {
    const p = previewAllocation(100_000, [
      { label: "A", method: "PERCENT", percentBps: 8000 },
      { label: "B", method: "PERCENT", percentBps: 4000 },
    ]);
    expect(p.totalPercentBps).toBe(12_000);
    expect(p.overAllocated).toBe(true);
    expect(sum(p.lines.map((l) => l.amount))).toBe(100_000);
  });

  it("never loses or invents a cent", () => {
    const p = previewAllocation(123_457, [
      { label: "A", method: "PERCENT", percentBps: 3333 },
      { label: "B", method: "PERCENT", percentBps: 3333 },
      { label: "C", method: "FIXED", amountCents: 999 },
      { label: "D", method: "PERCENT", percentBps: 3334 },
    ]);
    expect(sum(p.lines.map((l) => l.amount)) + p.unallocated).toBe(123_457);
    expect(p.lines.every((l) => Number.isInteger(l.amount) && l.amount >= 0)).toBe(true);
  });

  it("handles an empty or zero paycheque", () => {
    const p = previewAllocation(0, [{ label: "A", method: "FIXED", amountCents: 5_000 }]);
    expect(p.lines[0].amount).toBe(0);
    expect(p.unallocated).toBe(0);
    expect(p.shortfall).toBe(5_000);
    expect(previewAllocation(10_000, []).unallocated).toBe(10_000);
  });
});

const biweekly: PayScheduleSource = {
  id: "s1",
  name: "Employer",
  frequency: "BIWEEKLY",
  averageAmountCents: 187_000,
  lastPaidDate: "2026-09-18",
  nextExpectedDate: "2026-10-02",
  semiMonthlyDays: [15, 31],
};

describe("paydaysBetween", () => {
  it("lists upcoming paydays from the next expected date", () => {
    expect(paydaysBetween(biweekly, "2026-09-30", "2026-11-15").map((p) => p.date)).toEqual(["2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13"]);
  });

  it("follows a next payday the user moved by hand instead of adding a second one", () => {
    const moved = { ...biweekly, nextExpectedDate: "2026-10-01" };
    expect(paydaysBetween(moved, "2026-09-30", "2026-10-20").map((p) => p.date)).toEqual(["2026-10-01", "2026-10-15"]);
  });

  it("keeps the cadence when the next expected date is stale and skips the last payday", () => {
    const stale = { ...biweekly, nextExpectedDate: "2026-09-18" };
    expect(paydaysBetween(stale, "2026-09-18", "2026-10-03").map((p) => p.date)).toEqual(["2026-10-02"]);
  });

  it("supports twice-a-month pay on fixed days (31 = last day of the month)", () => {
    const semi: PayScheduleSource = { ...biweekly, frequency: "SEMI_MONTHLY", lastPaidDate: "2026-09-15", nextExpectedDate: "2026-09-30", semiMonthlyDays: [15, 31] };
    expect(paydaysBetween(semi, "2026-09-20", "2026-11-30").map((p) => p.date)).toEqual(["2026-09-30", "2026-10-15", "2026-10-31", "2026-11-15", "2026-11-30"]);
  });

  it("returns nothing without any known date", () => {
    expect(paydaysBetween({ ...biweekly, lastPaidDate: null, nextExpectedDate: null }, "2026-09-01", "2026-12-31")).toEqual([]);
  });
});

describe("nextPayday", () => {
  it("is the first payday on or after the given day", () => {
    expect(nextPayday(biweekly, "2026-09-30")).toBe("2026-10-02");
    expect(nextPayday(biweekly, "2026-10-02")).toBe("2026-10-02");
    expect(nextPayday(biweekly, "2026-10-03")).toBe("2026-10-16");
  });

  it("works for monthly pay at the end of the month", () => {
    const monthly: PayScheduleSource = { ...biweekly, frequency: "MONTHLY", lastPaidDate: "2026-08-31", nextExpectedDate: "2026-08-31" };
    expect(nextPayday(monthly, "2026-09-01")).toBe("2026-09-30");
  });
});

describe("schedule labels", () => {
  it("orders day-of-month suffixes correctly, with 31 as the last day", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30].map(dayOfMonthLabel)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "30th"]);
    expect(dayOfMonthLabel(31)).toBe("last day");
  });

  it("names semi-monthly days in order and falls back to the frequency", () => {
    expect(scheduleLabel("SEMI_MONTHLY", [31, 15])).toBe("Twice a month · 15th and last day");
    expect(scheduleLabel("BIWEEKLY", [15, 31])).toBe("Every 2 weeks");
    expect(scheduleLabel("IRREGULAR", [])).toBe("Irregular");
  });
});
