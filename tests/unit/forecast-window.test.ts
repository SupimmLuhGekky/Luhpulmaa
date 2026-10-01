import { describe, expect, it } from "vitest";
import { calculateCashFlow, type CashFlowEvent } from "@/lib/finance/calculations";
import { forecastWindow, parseHorizon } from "@/lib/forecast/window";

const today = "2026-09-30";
const upcoming: CashFlowEvent[] = [
  { date: "2026-10-01", amount: -125_000, kind: "bill", label: "Rent" },
  { date: "2026-10-01", amount: -15_000, kind: "goal", label: "Emergency fund (planned)" },
  { date: "2026-10-02", amount: 185_500, kind: "income", label: "Paycheque" },
  { date: "2026-10-08", amount: -2_299, kind: "subscription", label: "Netflix" },
  { date: "2026-10-16", amount: 185_500, kind: "income", label: "Paycheque" },
  { date: "2026-11-20", amount: -8_950, kind: "bill", label: "Insurance" },
  { date: "2026-12-20", amount: -8_950, kind: "bill", label: "Insurance" },
];
const base = { today, startingBalance: 570_694, dailyDiscretionary: 4_688, minimumBuffer: 50_000, upcoming };

describe("forecastWindow", () => {
  it("matches a forecast computed directly for that horizon", () => {
    for (const days of [7, 30, 60, 90]) {
      const end = new Date(Date.UTC(2026, 8, 30 + days - 1)).toISOString().slice(0, 10);
      const direct = calculateCashFlow(base.startingBalance, upcoming.filter((e) => e.date <= end), today, days, base.dailyDiscretionary);
      const w = forecastWindow(base, days);
      expect(w.days).toEqual(direct.days);
      expect(w.endingBalance).toBe(direct.endingBalance);
      expect(w.lowestBalance).toBe(direct.lowestBalance);
      expect(w.byKind).toEqual(direct.byKind);
      expect(w.horizonDays).toBe(days);
      expect(w.end).toBe(end);
    }
  });

  it("is a prefix of the longer forecast", () => {
    const long = forecastWindow(base, 90);
    const short = forecastWindow(base, 30);
    expect(long.days.slice(0, 30)).toEqual(short.days);
    expect(short.upcoming.every((e) => e.date <= "2026-10-29")).toBe(true);
    expect(short.upcoming).toHaveLength(5);
  });

  it("lists the days below the buffer", () => {
    // 140,000 − 4,688 on day one, then rent, the planned saving and a day's spending take it to −9,376
    // until the paycheque lands the next day.
    const w = forecastWindow({ ...base, startingBalance: 140_000 }, 7);
    expect(w.belowBuffer).toEqual(["2026-10-01"]);
    expect(w.lowestBalance).toBe(-9_376);
    expect(w.lowestBalanceDate).toBe("2026-10-01");
  });
});

describe("parseHorizon", () => {
  it("accepts 7, 30, 60 and 90 only", () => {
    expect(parseHorizon("60")).toBe(60);
    expect(parseHorizon(7)).toBe(7);
    expect(parseHorizon("45")).toBe(30);
    expect(parseHorizon(undefined, 90)).toBe(90);
  });
});
