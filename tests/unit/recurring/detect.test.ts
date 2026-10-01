import { describe, expect, it } from "vitest";
import { classifyFrequency, detectRecurring, projectNext, type RecurringInputTxn } from "@/lib/recurring/detect";

const TODAY = "2026-10-01";
let seq = 0;
function txn(date: string, amountCents: number, description: string, extra: Partial<RecurringInputTxn> = {}): RecurringInputTxn {
  seq += 1;
  return { id: `t${seq}`, date, amountCents, description, merchantName: null, accountId: "acct-chequing", categoryId: null, isTransfer: false, ...extra };
}
const series = (dates: string[], amountCents: number, description: string, extra: Partial<RecurringInputTxn> = {}) => dates.map((d) => txn(d, amountCents, description, extra));

describe("detectRecurring", () => {
  it("detects a monthly subscription and projects the next charge", () => {
    const [netflix, ...rest] = detectRecurring(series(["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"], -1699, "NETFLIX.COM"), TODAY);
    expect(rest).toHaveLength(0);
    expect(netflix).toMatchObject({
      seriesKey: "netflix",
      name: "NETFLIX.COM",
      direction: "OUTFLOW",
      frequency: "MONTHLY",
      averageAmountCents: -1699,
      lastAmountCents: -1699,
      lastDate: "2026-09-15",
      nextExpectedDate: "2026-10-15",
      occurrenceCount: 4,
      confidence: 93,
      isSubscriptionLike: true,
    });
    expect(netflix.transactionIds).toHaveLength(4);
  });

  it("detects biweekly pay as income with full confidence", () => {
    const [pay] = detectRecurring(
      series(["2026-07-03", "2026-07-17", "2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11", "2026-09-25"], 142000, "HARBOURFRONT GRILL PAYROLL DEP"),
      TODAY,
    );
    expect(pay).toMatchObject({ direction: "INFLOW", frequency: "BIWEEKLY", nextExpectedDate: "2026-10-09", confidence: 100, averageAmountCents: 142000, isSubscriptionLike: false });
  });

  it("tolerates a day or two of jitter in monthly dates", () => {
    const [rent] = detectRecurring(series(["2026-06-01", "2026-07-02", "2026-07-31", "2026-09-01"], -145000, "LOYER APPARTEMENT"), TODAY);
    expect(rent).toMatchObject({ frequency: "MONTHLY", nextExpectedDate: "2026-10-01" });
  });

  it("tolerates moderate amount drift and reports the median", () => {
    const rows = [
      txn("2026-06-20", -9800, "HYDRO-QUEBEC"),
      txn("2026-07-20", -11500, "HYDRO-QUEBEC"),
      txn("2026-08-20", -10000, "HYDRO-QUEBEC"),
      txn("2026-09-20", -12000, "HYDRO-QUEBEC"),
    ];
    const [hydro] = detectRecurring(rows, TODAY);
    expect(hydro).toMatchObject({ frequency: "MONTHLY", averageAmountCents: -10750, lastAmountCents: -12000, nextExpectedDate: "2026-10-20" });
  });

  it("rejects series whose amounts swing wildly", () => {
    const rows = [txn("2026-06-20", -5000, "ACME UTILITY"), txn("2026-07-20", -15000, "ACME UTILITY"), txn("2026-08-20", -10000, "ACME UTILITY"), txn("2026-09-20", -30000, "ACME UTILITY")];
    expect(detectRecurring(rows, TODAY)).toEqual([]);
  });

  it("needs three occurrences, or two monthly ones with the same amount", () => {
    expect(detectRecurring(series(["2026-08-10", "2026-09-10"], -1199, "SPOTIFY"), TODAY)).toMatchObject([{ frequency: "MONTHLY", occurrenceCount: 2, nextExpectedDate: "2026-10-10" }]);
    expect(detectRecurring([txn("2026-08-10", -1199, "SPOTIFY"), txn("2026-09-10", -2500, "SPOTIFY")], TODAY)).toEqual([]);
    expect(detectRecurring(series(["2026-09-04", "2026-09-18"], -2000, "ACME GYM"), TODAY)).toEqual([]);
    expect(detectRecurring(series(["2026-09-15"], -1699, "NETFLIX.COM"), TODAY)).toEqual([]);
    expect(detectRecurring([], TODAY)).toEqual([]);
  });

  it("drops a series that stopped more than two cycles ago", () => {
    expect(detectRecurring(series(["2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15"], -1699, "NETFLIX.COM"), TODAY)).toEqual([]);
  });

  it("ignores variable weekly spending but keeps a stable weekly charge", () => {
    const coffee = [txn("2026-09-03", -250, "CAFE OLIMPICO"), txn("2026-09-10", -575, "CAFE OLIMPICO"), txn("2026-09-17", -310, "CAFE OLIMPICO"), txn("2026-09-24", -890, "CAFE OLIMPICO")];
    expect(detectRecurring(coffee, TODAY)).toEqual([]);
    expect(detectRecurring(series(["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24"], -2500, "PANIER BIO"), TODAY)).toMatchObject([{ frequency: "WEEKLY", nextExpectedDate: "2026-10-01" }]);
  });

  it("recognises semi-monthly pay on the 15th and the last day", () => {
    const [pay] = detectRecurring(series(["2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31", "2026-09-15", "2026-09-30"], 210000, "EMPLOYER PAY"), TODAY);
    expect(pay).toMatchObject({ frequency: "SEMI_MONTHLY", semiMonthlyDays: [15, 31], nextExpectedDate: "2026-10-15" });
  });

  it("ignores transfers and zero amounts, and separates inflows from outflows", () => {
    expect(detectRecurring(series(["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"], -50000, "TRANSFER TO SAVINGS", { isTransfer: true }), TODAY)).toEqual([]);
    expect(detectRecurring(series(["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"], 0, "ACME ADJUSTMENT"), TODAY)).toEqual([]);
    const mixed = [...series(["2026-07-15", "2026-08-15", "2026-09-15"], -4000, "ACME CO"), ...series(["2026-07-01", "2026-08-01", "2026-09-01"], 9000, "ACME CO")];
    expect(detectRecurring(mixed, TODAY).map((s) => s.direction).sort()).toEqual(["INFLOW", "OUTFLOW"]);
  });

  it("collapses same-day split payments into one occurrence", () => {
    const rows = [txn("2026-07-15", -1000, "ACME RENT CO"), txn("2026-07-15", -1000, "ACME RENT CO"), txn("2026-08-15", -2000, "ACME RENT CO"), txn("2026-09-15", -2000, "ACME RENT CO")];
    expect(detectRecurring(rows, TODAY)).toMatchObject([{ frequency: "MONTHLY", occurrenceCount: 3, averageAmountCents: -2000 }]);
    expect(detectRecurring(rows, TODAY)[0].transactionIds).toHaveLength(4);
  });

  it("respects a custom minimum confidence", () => {
    const rows = series(["2026-08-10", "2026-09-10"], -1199, "SPOTIFY");
    expect(detectRecurring(rows, TODAY, { minConfidence: 95 })).toEqual([]);
  });

  it("keeps an end-of-month series on the last day after catching up past February", () => {
    const rows = series(["2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31"], -50000, "LOYER APPARTEMENT");
    // Jan 31 → Feb 28 → (chained) Mar 28; the rent is due Mar 31.
    expect(detectRecurring(rows, "2026-03-05")[0].nextExpectedDate).toBe("2026-03-31");
  });

  it("keeps the 31st when the last payment fell on November 30", () => {
    const rows = series(["2025-08-31", "2025-09-30", "2025-10-31", "2025-11-30"], -50000, "LOYER APPARTEMENT");
    expect(detectRecurring(rows, "2025-12-05")[0].nextExpectedDate).toBe("2025-12-31");
    const thirtieth = series(["2025-09-30", "2025-10-30", "2025-11-30"], -50000, "LOYER APPARTEMENT");
    expect(detectRecurring(thirtieth, "2025-12-05")[0].nextExpectedDate).toBe("2025-12-30");
  });
});

describe("classifyFrequency", () => {
  it("needs at least two distinct dates", () => {
    expect(classifyFrequency([])).toBeNull();
    expect(classifyFrequency(["2026-01-01"])).toBeNull();
    expect(classifyFrequency(["2026-01-01", "2026-01-01"])).toBeNull();
  });

  it("maps the median gap to a frequency band", () => {
    expect(classifyFrequency(["2026-09-03", "2026-09-10", "2026-09-17"])).toEqual({ frequency: "WEEKLY", regularity: 1 });
    expect(classifyFrequency(["2025-01-10", "2025-04-10", "2025-07-10", "2025-10-10"])).toEqual({ frequency: "QUARTERLY", regularity: 1 });
    expect(classifyFrequency(["2024-03-01", "2025-03-01", "2026-03-01"])).toEqual({ frequency: "YEARLY", regularity: 1 });
    expect(classifyFrequency(["2026-01-01", "2026-02-15", "2026-04-01"])).toBeNull(); // 45-day gaps
  });

  it("does not mistake biweekly dates for semi-monthly ones", () => {
    expect(classifyFrequency(["2026-07-03", "2026-07-17", "2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11"])?.frequency).toBe("BIWEEKLY");
  });

  it("is order-independent", () => {
    expect(classifyFrequency(["2026-09-15", "2026-07-15", "2026-08-15"])).toEqual({ frequency: "MONTHLY", regularity: 1 });
  });
});

describe("projectNext", () => {
  it("projects each frequency", () => {
    expect(projectNext("2026-10-01", "WEEKLY")).toBe("2026-10-08");
    expect(projectNext("2026-10-01", "BIWEEKLY")).toBe("2026-10-15");
    expect(projectNext("2026-01-31", "MONTHLY")).toBe("2026-02-28");
    expect(projectNext("2026-11-30", "QUARTERLY")).toBe("2027-02-28");
    expect(projectNext("2028-02-29", "YEARLY")).toBe("2029-02-28");
    expect(projectNext("2026-10-01", "IRREGULAR")).toBe("2026-10-31");
  });

  it("alternates between the two semi-monthly days, clamping to month end", () => {
    expect(projectNext("2026-09-30", "SEMI_MONTHLY", [15, 31])).toBe("2026-10-15");
    expect(projectNext("2026-02-28", "SEMI_MONTHLY", [15, 31])).toBe("2026-03-15");
    expect(projectNext("2026-02-15", "SEMI_MONTHLY", [15, 31])).toBe("2026-02-28");
    expect(projectNext("2026-01-15", "SEMI_MONTHLY", [15, 30])).toBe("2026-01-30");
    expect(projectNext("2026-01-15", "SEMI_MONTHLY", [1, 15])).toBe("2026-02-01");
    expect(projectNext("2026-01-01", "SEMI_MONTHLY", [1, 15])).toBe("2026-01-15");
  });
});
