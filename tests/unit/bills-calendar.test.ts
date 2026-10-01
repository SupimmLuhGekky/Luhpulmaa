import { describe, expect, it } from "vitest";
import { monthGrid, occurrenceStatus, parseCalendarParams, paydayWindow, shiftDate, summarizeOccurrences, viewRange, weekDates } from "@/lib/bills/calendar";

describe("monthGrid", () => {
  it("covers the whole month in full weeks starting on the chosen weekday", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const sunday = monthGrid("2026-10-15", 0);
    expect(sunday).toHaveLength(5);
    expect(sunday[0][0]).toBe("2026-09-27");
    expect(sunday[4][6]).toBe("2026-10-31");
    const monday = monthGrid("2026-10-15", 1);
    expect(monday[0][0]).toBe("2026-09-28");
    expect(monday[monday.length - 1][6]).toBe("2026-11-01");
    expect(monday.every((w) => w.length === 7)).toBe(true);
  });

  it("handles a month that needs six rows", () => {
    // August 2026 starts on a Saturday and has 31 days.
    const grid = monthGrid("2026-08-01", 0);
    expect(grid).toHaveLength(6);
    expect(grid[5][1]).toBe("2026-08-31");
  });
});

describe("weekDates / viewRange / shiftDate", () => {
  it("returns the seven days of the week containing a date", () => {
    expect(weekDates("2026-09-30", 0)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("gives each view the dates it displays", () => {
    expect(viewRange("week", "2026-09-30", 1)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(viewRange("month", "2026-10-15", 0)).toEqual({ from: "2026-09-27", to: "2026-10-31" });
    expect(viewRange("list", "2026-10-15", 0)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("moves by weeks or months", () => {
    expect(shiftDate("week", "2026-09-30", 1)).toBe("2026-10-07");
    expect(shiftDate("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftDate("list", "2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("occurrenceStatus", () => {
  it("prefers paid, then overdue, due today and upcoming", () => {
    expect(occurrenceStatus({ paid: true, dueDate: "2026-09-01" }, "2026-09-30")).toBe("paid");
    expect(occurrenceStatus({ paid: false, dueDate: "2026-09-29" }, "2026-09-30")).toBe("overdue");
    expect(occurrenceStatus({ paid: false, dueDate: "2026-09-30" }, "2026-09-30")).toBe("due-today");
    expect(occurrenceStatus({ paid: false, dueDate: "2026-10-01" }, "2026-09-30")).toBe("upcoming");
  });
});

describe("paydayWindow", () => {
  it("runs from today to the day before the next payday", () => {
    expect(paydayWindow("2026-09-30", "2026-10-02")).toEqual({ from: "2026-09-30", to: "2026-10-01" });
  });

  it("uses the next 14 days when no payday is known", () => {
    expect(paydayWindow("2026-09-30", null)).toEqual({ from: "2026-09-30", to: "2026-10-13" });
  });

  it("never ends before today", () => {
    expect(paydayWindow("2026-09-30", "2026-09-30")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });
});

describe("summarizeOccurrences", () => {
  it("totals paid, unpaid and overdue amounts", () => {
    const t = summarizeOccurrences(
      [
        { paid: true, dueDate: "2026-09-01", amountCents: 125_000 },
        { paid: false, dueDate: "2026-09-12", amountCents: 7_500 },
        { paid: false, dueDate: "2026-10-03", amountCents: 6_500 },
      ],
      "2026-09-30",
    );
    expect(t).toEqual({ count: 3, total: 139_000, paidCount: 1, paidTotal: 125_000, unpaidTotal: 14_000, overdueCount: 1, overdueTotal: 7_500 });
  });
});

describe("parseCalendarParams", () => {
  it("accepts known views and real dates only", () => {
    expect(parseCalendarParams({ view: "week", date: "2026-10-05" }, "2026-09-30")).toEqual({ view: "week", date: "2026-10-05" });
    expect(parseCalendarParams({ view: "year", date: "2026-02-30" }, "2026-09-30")).toEqual({ view: "month", date: "2026-09-30" });
    expect(parseCalendarParams({ view: ["list"], date: undefined }, "2026-09-30")).toEqual({ view: "month", date: "2026-09-30" });
  });

  it("ignores dates too far from today", () => {
    expect(parseCalendarParams({ view: "month", date: "0001-01-01" }, "2026-09-30").date).toBe("2026-09-30");
    expect(parseCalendarParams({ view: "month", date: "2099-01-01" }, "2026-09-30").date).toBe("2026-09-30");
    expect(parseCalendarParams({ view: "month", date: "2036-09-30" }, "2026-09-30").date).toBe("2036-09-30");
  });
});
