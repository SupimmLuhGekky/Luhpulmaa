import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonthKey,
  addMonths,
  addYears,
  dateInZone,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  eachDay,
  eachMonth,
  endOfMonth,
  endOfWeek,
  formatDate,
  formatDateTime,
  formatMonthKey,
  formatRelativeDay,
  formatRelativeTime,
  fromDbDate,
  isLocalDate,
  isMonthKey,
  isValidTimeZone,
  isWithin,
  monthKey,
  monthRange,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  toDbDate,
  todayIn,
} from "@/lib/dates";

const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("isLocalDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isLocalDate("2026-10-01")).toBe(true);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-04-31")).toBe(false);
    expect(isLocalDate("2026-1-01")).toBe(false);
    expect(isLocalDate("2026-10-01T00:00:00Z")).toBe(false);
    expect(isLocalDate(20261001)).toBe(false);
    expect(isLocalDate(null)).toBe(false);
  });
});

describe("todayIn / dateInZone", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flips the date at local midnight in Toronto, summer (EDT) and winter (EST)", () => {
    expect(todayIn("America/Toronto", new Date("2026-10-01T03:59:59Z"))).toBe("2026-09-30");
    expect(todayIn("America/Toronto", new Date("2026-10-01T04:00:00Z"))).toBe("2026-10-01");
    expect(todayIn("America/Toronto", new Date("2026-01-15T04:59:59Z"))).toBe("2026-01-14");
    expect(todayIn("America/Toronto", new Date("2026-01-15T05:00:00Z"))).toBe("2026-01-15");
  });

  it("handles the spring-forward and fall-back days", () => {
    // DST starts 2026-03-08 at 02:00 local.
    expect(todayIn("America/Toronto", new Date("2026-03-08T04:59:59Z"))).toBe("2026-03-07");
    expect(todayIn("America/Toronto", new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(todayIn("America/Toronto", new Date("2026-03-09T03:59:59Z"))).toBe("2026-03-08");
    expect(todayIn("America/Toronto", new Date("2026-03-09T04:00:00Z"))).toBe("2026-03-09");
    // DST ends 2026-11-01 at 02:00 local; that day is 25 hours long.
    expect(todayIn("America/Toronto", new Date("2026-11-01T03:59:59Z"))).toBe("2026-10-31");
    expect(todayIn("America/Toronto", new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    expect(todayIn("America/Toronto", new Date("2026-11-02T04:59:59Z"))).toBe("2026-11-01");
    expect(todayIn("America/Toronto", new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
  });

  it("gives different dates for the same instant in different zones", () => {
    const instant = new Date("2026-10-01T02:30:00Z");
    expect(dateInZone(instant, "America/Vancouver")).toBe("2026-09-30");
    expect(dateInZone(instant, "America/Toronto")).toBe("2026-09-30");
    expect(dateInZone(instant, "America/St_Johns")).toBe("2026-10-01"); // UTC−2:30 → exactly midnight
    expect(dateInZone(new Date("2026-10-01T02:29:59Z"), "America/St_Johns")).toBe("2026-09-30");
    expect(dateInZone(instant, "UTC")).toBe("2026-10-01");
    expect(dateInZone(instant, "Europe/Paris")).toBe("2026-10-01");
    expect(dateInZone(instant, "Pacific/Kiritimati")).toBe("2026-10-01");
    expect(dateInZone(instant, "Pacific/Pago_Pago")).toBe("2026-09-30");
    expect(dateInZone(new Date("2026-09-30T10:00:00Z"), "Pacific/Kiritimati")).toBe("2026-10-01");
  });

  it("falls back to America/Toronto for unknown or empty zones", () => {
    const instant = new Date("2026-10-01T03:00:00Z");
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("America/Montreal")).toBe(true);
    expect(todayIn("Mars/Olympus_Mons", instant)).toBe("2026-09-30");
    expect(todayIn("", instant)).toBe("2026-09-30");
    expect(todayIn(undefined, instant)).toBe("2026-09-30");
  });

  it("uses the current clock when no instant is passed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T23:30:00-05:00"));
    expect(todayIn("America/Toronto")).toBe("2026-12-31");
    expect(todayIn("UTC")).toBe("2027-01-01");
  });
});

describe("addDays / daysBetween", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-10-01", 0)).toBe("2026-10-01");
    expect(addDays("2026-10-01", 365)).toBe("2027-10-01");
    expect(addDays("2027-10-01", 366)).toBe("2028-10-01");
  });

  it("is not affected by DST transitions", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("returns b − a in whole days", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBe(-30);
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("rejects malformed dates", () => {
    expect(() => addDays("2026/10/01", 1)).toThrow(RangeError);
    expect(() => daysBetween("2026-10-01", "Oct 1")).toThrow(RangeError);
  });
});

describe("addMonths / addYears", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-05-31", 1)).toBe("2026-06-30");
    expect(addMonths("2026-01-31", 13)).toBe("2027-02-28");
  });

  it("crosses year boundaries in both directions", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-10-01", 0)).toBe("2026-10-01");
  });

  it("restores a preferred day after a short month", () => {
    expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonths("2026-02-28", 2, 31)).toBe("2026-04-30");
  });

  it("keeps Feb 29 only in leap years", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2028-02-29", 4)).toBe("2032-02-29");
    expect(addYears("2026-10-01", -1)).toBe("2025-10-01");
  });
});

describe("month and week helpers", () => {
  it("knows month lengths including century leap rules", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("finds month starts and ends", () => {
    expect(startOfMonth("2026-10-17")).toBe("2026-10-01");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2026-12-05")).toBe("2026-12-31");
    expect(endOfMonth("2026-04-30")).toBe("2026-04-30");
  });

  it("handles month keys", () => {
    expect(monthKey("2026-10-01")).toBe("2026-10");
    expect(isMonthKey("2026-10")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-1")).toBe(false);
    expect(isMonthKey(202610)).toBe(false);
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(addMonthKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("finds weeks, quarters and years", () => {
    expect(dayOfWeek("2026-10-01")).toBe(4); // Thursday
    expect(startOfWeek("2026-10-01")).toBe("2026-09-27");
    expect(startOfWeek("2026-10-01", 1)).toBe("2026-09-28");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-27");
    expect(endOfWeek("2026-10-01")).toBe("2026-10-03");
    expect(startOfQuarter("2026-10-01")).toBe("2026-10-01");
    expect(startOfQuarter("2026-09-30")).toBe("2026-07-01");
    expect(startOfQuarter("2026-02-15")).toBe("2026-01-01");
    expect(startOfYear("2026-10-01")).toBe("2026-01-01");
  });

  it("iterates days and months inclusively", () => {
    expect(eachDay("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(eachDay("2026-10-02", "2026-10-01")).toEqual([]);
    expect(eachMonth("2026-11-15", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(isWithin("2026-10-01", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isWithin("2026-10-31", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isWithin("2026-11-01", "2026-10-01", "2026-10-31")).toBe(false);
  });
});

describe("database date conversion", () => {
  it("round-trips through UTC midnight", () => {
    const db = toDbDate("2026-11-01");
    expect(db.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(fromDbDate(db)).toBe("2026-11-01");
    expect(fromDbDate(null)).toBeNull();
    expect(fromDbDate(undefined)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats calendar dates without shifting them", () => {
    expect(formatDate("2026-10-01")).toBe("Oct 1, 2026");
    expect(formatDate("2026-11-01")).toBe("Nov 1, 2026");
    expect(formatDate("2026-10-01", "short")).toBe("2026-10-01");
    expect(formatDate("2026-10-01", "long")).toBe("October 1, 2026");
    expect(formatDate("2026-10-01", "monthDay")).toBe("Oct 1");
    expect(formatDate("2026-10-01", "weekdayShort")).toBe("Thu, Oct 1");
    expect(plain(formatDate("2026-10-01", "medium", "fr-CA"))).toBe("1 oct. 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("formats month keys", () => {
    expect(formatMonthKey("2026-10")).toBe("October 2026");
    expect(formatMonthKey("2026-10", "en-CA", "short")).toBe("Oct 26");
    expect(formatMonthKey("2026-10", "fr-CA")).toBe("octobre 2026");
  });

  it("describes nearby days relative to today", () => {
    const today = "2026-10-01";
    expect(formatRelativeDay("2026-10-01", today)).toBe("Today");
    expect(formatRelativeDay("2026-10-02", today)).toBe("Tomorrow");
    expect(formatRelativeDay("2026-09-30", today)).toBe("Yesterday");
    expect(formatRelativeDay("2026-10-04", today)).toBe("In 3 days");
    expect(formatRelativeDay("2026-10-07", today)).toBe("In 6 days");
    expect(formatRelativeDay("2026-10-08", today)).toBe("Oct 8");
    expect(formatRelativeDay("2026-09-29", today)).toBe("Sep 29");
  });

  it("formats instants in the user's time zone", () => {
    expect(plain(formatDateTime(new Date("2026-10-01T16:05:00Z"), "America/Toronto"))).toBe("Oct 1, 2026, 12:05 p.m.");
    expect(plain(formatDateTime("2026-10-01T03:30:00Z", "America/Vancouver"))).toBe("Sep 30, 2026, 8:30 p.m.");
    expect(plain(formatDateTime("2026-10-01T03:30:00Z", "Not/AZone"))).toBe("Sep 30, 2026, 11:30 p.m.");
  });

  it("describes elapsed time", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    expect(formatRelativeTime(ago(30), now)).toBe("just now");
    expect(formatRelativeTime(ago(5 * 60), now)).toBe("5 min ago");
    expect(formatRelativeTime(ago(3 * 3600), now)).toBe("3 h ago");
    expect(formatRelativeTime(ago(2 * 86400), now)).toBe("2 d ago");
    expect(formatRelativeTime(ago(40 * 86400), now)).toBe("2026-08-22");
    expect(formatRelativeTime("2026-10-01T11:00:00Z", now)).toBe("1 h ago");
  });
});
