import { describe, expect, it } from "vitest";
import { FREQUENCY_DAYS, FREQUENCY_LABELS, OCCURRENCES_PER_YEAR, nextOccurrence, occurrencesBetween } from "@/lib/dates/schedule";

describe("occurrencesBetween", () => {
  it("steps weekly and biweekly schedules from a past anchor", () => {
    expect(occurrencesBetween("2026-09-04", "WEEKLY", "2026-10-01", "2026-10-31")).toEqual(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
    expect(occurrencesBetween("2026-09-04", "BIWEEKLY", "2026-10-01", "2026-10-31")).toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
  });

  it("never returns dates before the anchor", () => {
    expect(occurrencesBetween("2026-10-09", "BIWEEKLY", "2026-10-01", "2026-10-31")).toEqual(["2026-10-09", "2026-10-23"]);
    expect(occurrencesBetween("2026-10-20", "SEMI_MONTHLY", "2026-10-01", "2026-11-30")).toEqual(["2026-10-31", "2026-11-15", "2026-11-30"]);
    expect(occurrencesBetween("2026-12-01", "MONTHLY", "2026-10-01", "2026-12-31")).toEqual(["2026-12-01"]);
  });

  it("keeps biweekly paydays in phase across a year boundary and DST", () => {
    const dates = occurrencesBetween("2026-01-02", "BIWEEKLY", "2026-10-25", "2027-01-10");
    expect(dates).toEqual(["2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18", "2027-01-01"]);
  });

  it("generates semi-monthly dates on the 15th and the last day by default", () => {
    expect(occurrencesBetween("2026-01-15", "SEMI_MONTHLY", "2026-02-01", "2026-03-31")).toEqual(["2026-02-15", "2026-02-28", "2026-03-15", "2026-03-31"]);
    expect(occurrencesBetween("2028-01-15", "SEMI_MONTHLY", "2028-02-01", "2028-02-29")).toEqual(["2028-02-15", "2028-02-29"]);
  });

  it("accepts custom semi-monthly days in any order", () => {
    expect(occurrencesBetween("2026-01-01", "SEMI_MONTHLY", "2026-02-01", "2026-03-31", { semiMonthlyDays: [15, 1] })).toEqual([
      "2026-02-01",
      "2026-02-15",
      "2026-03-01",
      "2026-03-15",
    ]);
    expect(occurrencesBetween("2026-01-01", "SEMI_MONTHLY", "2026-02-01", "2026-02-28", { semiMonthlyDays: [30, 14] })).toEqual(["2026-02-14", "2026-02-28"]);
  });

  it("keeps the anchor's day of month instead of drifting after short months", () => {
    expect(occurrencesBetween("2026-01-31", "MONTHLY", "2026-01-01", "2026-06-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
    expect(occurrencesBetween("2028-01-31", "MONTHLY", "2028-02-01", "2028-03-31")).toEqual(["2028-02-29", "2028-03-31"]);
    expect(occurrencesBetween("2026-01-31", "IRREGULAR", "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-31"]);
  });

  it("supports quarterly and yearly schedules, including Feb 29 anchors", () => {
    expect(occurrencesBetween("2026-01-15", "QUARTERLY", "2026-10-01", "2027-06-30")).toEqual(["2026-10-15", "2027-01-15", "2027-04-15"]);
    expect(occurrencesBetween("2028-02-29", "YEARLY", "2028-01-01", "2033-12-31")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29", "2033-02-28"]);
  });

  it("handles one-time schedules", () => {
    expect(occurrencesBetween("2026-10-05", "ONE_TIME", "2026-10-01", "2026-10-31")).toEqual(["2026-10-05"]);
    expect(occurrencesBetween("2026-09-05", "ONE_TIME", "2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("stops at the end date and respects the limit", () => {
    expect(occurrencesBetween("2026-01-10", "MONTHLY", "2026-01-01", "2026-12-31", { endDate: "2026-04-10" })).toEqual(["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"]);
    expect(occurrencesBetween("2026-01-10", "MONTHLY", "2026-06-01", "2026-12-31", { endDate: "2026-04-10" })).toEqual([]);
    expect(occurrencesBetween("2026-09-04", "WEEKLY", "2026-10-01", "2026-12-31", { limit: 2 })).toEqual(["2026-10-02", "2026-10-09"]);
    expect(occurrencesBetween("2026-09-04", "WEEKLY", "2026-10-31", "2026-10-01")).toEqual([]);
  });
});

describe("nextOccurrence", () => {
  it("finds the next monthly date, clamped to short months", () => {
    expect(nextOccurrence("2026-01-31", "MONTHLY", "2026-02-01")).toBe("2026-02-28");
    expect(nextOccurrence("2026-01-31", "MONTHLY", "2026-03-01")).toBe("2026-03-31");
    expect(nextOccurrence("2026-09-15", "MONTHLY", "2026-10-15")).toBe("2026-10-15");
    expect(nextOccurrence("2026-09-15", "MONTHLY", "2026-10-16")).toBe("2026-11-15");
  });

  it("finds the next weekly, biweekly and semi-monthly date", () => {
    expect(nextOccurrence("2026-09-04", "BIWEEKLY", "2026-10-01")).toBe("2026-10-02");
    expect(nextOccurrence("2026-09-04", "BIWEEKLY", "2026-10-03")).toBe("2026-10-16");
    expect(nextOccurrence("2026-10-01", "WEEKLY", "2026-10-01")).toBe("2026-10-01");
    expect(nextOccurrence("2026-01-15", "SEMI_MONTHLY", "2026-02-16")).toBe("2026-02-28");
    expect(nextOccurrence("2026-01-15", "SEMI_MONTHLY", "2026-03-01")).toBe("2026-03-15");
  });

  it("finds the next yearly date", () => {
    expect(nextOccurrence("2025-11-20", "YEARLY", "2026-10-01")).toBe("2026-11-20");
    expect(nextOccurrence("2024-02-29", "YEARLY", "2027-03-01")).toBe("2028-02-29");
  });

  it("returns the anchor of a one-time schedule until it has passed", () => {
    expect(nextOccurrence("2026-10-05", "ONE_TIME", "2026-10-01")).toBe("2026-10-05");
    expect(nextOccurrence("2026-10-05", "ONE_TIME", "2026-10-05")).toBe("2026-10-05");
    expect(nextOccurrence("2026-10-05", "ONE_TIME", "2026-10-06")).toBeNull();
  });

  it("returns null after the schedule's end date", () => {
    expect(nextOccurrence("2026-01-10", "MONTHLY", "2026-07-01", { endDate: "2026-06-10" })).toBeNull();
  });

  it("finds a first occurrence that is more than a year away", () => {
    // A yearly renewal first due 14 months from now (e.g. a passport or a membership).
    expect(nextOccurrence("2027-12-01", "YEARLY", "2026-10-01")).toBe("2027-12-01");
    expect(nextOccurrence("2028-01-01", "QUARTERLY", "2026-10-01")).toBe("2028-01-01");
    expect(nextOccurrence("2027-11-20", "BIWEEKLY", "2026-10-01")).toBe("2027-11-20");
  });
});

describe("frequency tables", () => {
  it("cover every frequency consistently", () => {
    const keys = Object.keys(FREQUENCY_LABELS).sort();
    expect(Object.keys(OCCURRENCES_PER_YEAR).sort()).toEqual(keys);
    expect(Object.keys(FREQUENCY_DAYS).sort()).toEqual(keys);
    expect(OCCURRENCES_PER_YEAR).toMatchObject({ WEEKLY: 52, BIWEEKLY: 26, SEMI_MONTHLY: 24, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1, ONE_TIME: 0 });
  });
});
