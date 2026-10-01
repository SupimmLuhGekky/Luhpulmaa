import { describe, expect, it } from "vitest";
import {
  averageCents,
  calculateBudgetRemaining,
  calculateCashFlow,
  calculateGoalPace,
  calculateGoalProgress,
  calculateNetWorth,
  calculateRollover,
  calculateSafeToSpend,
  calculateSavingsRate,
  calculateZeroBased,
  medianCents,
  resolveBudgetAmount,
  type CashFlowEvent,
} from "@/lib/finance/calculations";

describe("calculateBudgetRemaining", () => {
  it("reports remaining and usage while on track", () => {
    expect(calculateBudgetRemaining(50000, 20000)).toEqual({ available: 50000, spent: 20000, remaining: 30000, usedBps: 4000, status: "on_track" });
    expect(calculateBudgetRemaining(50000, 39990).status).toBe("on_track");
  });

  it("warns from the threshold up to exactly the budget, then reports over", () => {
    expect(calculateBudgetRemaining(50000, 40000).status).toBe("warning");
    const exact = calculateBudgetRemaining(50000, 50000);
    expect(exact).toMatchObject({ remaining: 0, usedBps: 10000, status: "warning" });
    expect(calculateBudgetRemaining(50000, 50001)).toMatchObject({ remaining: -1, status: "over" });
  });

  it("honours a custom warning threshold", () => {
    expect(calculateBudgetRemaining(10000, 5000, 0, 5000).status).toBe("warning");
    expect(calculateBudgetRemaining(10000, 4999, 0, 5000).status).toBe("on_track");
  });

  it("adds the rollover to what is available", () => {
    expect(calculateBudgetRemaining(50000, 55000, 10000)).toEqual({ available: 60000, spent: 55000, remaining: 5000, usedBps: 9167, status: "warning" });
  });

  it("handles a zero budget", () => {
    expect(calculateBudgetRemaining(0, 0)).toEqual({ available: 0, spent: 0, remaining: 0, usedBps: 0, status: "on_track" });
    expect(calculateBudgetRemaining(0, 1)).toMatchObject({ remaining: -1, usedBps: 100000, status: "over" });
  });

  it("treats net refunds (negative spending) as money back", () => {
    expect(calculateBudgetRemaining(0, -500)).toMatchObject({ remaining: 500, usedBps: 0, status: "on_track" });
    expect(calculateBudgetRemaining(10000, -500)).toMatchObject({ remaining: 10500, usedBps: -500, status: "on_track" });
  });
});

describe("calculateRollover", () => {
  it("carries unspent money and never carries overspending", () => {
    expect(calculateRollover(50000, 30000)).toBe(20000);
    expect(calculateRollover(50000, 60000)).toBe(0);
    expect(calculateRollover(50000, 60000, 15000)).toBe(5000);
    expect(calculateRollover(0, 0, 0)).toBe(0);
  });
});

describe("resolveBudgetAmount", () => {
  it("uses the fixed amount as-is", () => {
    expect(resolveBudgetAmount({ amountType: "FIXED", amountCents: 12345, percentBps: null }, 500000)).toBe(12345);
    expect(resolveBudgetAmount({ amountType: "FIXED", amountCents: 12345, percentBps: 2000 }, null)).toBe(12345);
  });

  it("resolves a percentage of planned income, rounding to the cent", () => {
    expect(resolveBudgetAmount({ amountType: "PERCENT_OF_INCOME", amountCents: 0, percentBps: 1500 }, 500000)).toBe(75000);
    expect(resolveBudgetAmount({ amountType: "PERCENT_OF_INCOME", amountCents: 0, percentBps: 3333 }, 100)).toBe(33);
  });

  it("is zero without income or percentage", () => {
    expect(resolveBudgetAmount({ amountType: "PERCENT_OF_INCOME", amountCents: 999, percentBps: 1500 }, null)).toBe(0);
    expect(resolveBudgetAmount({ amountType: "PERCENT_OF_INCOME", amountCents: 999, percentBps: 1500 }, 0)).toBe(0);
    expect(resolveBudgetAmount({ amountType: "PERCENT_OF_INCOME", amountCents: 999, percentBps: null }, 500000)).toBe(0);
  });
});

describe("calculateZeroBased", () => {
  it("classifies the allocation state", () => {
    expect(calculateZeroBased(500000, [300000, 200000])).toEqual({ income: 500000, allocated: 500000, unallocated: 0, state: "fully_allocated" });
    expect(calculateZeroBased(500000, [300000])).toMatchObject({ unallocated: 200000, state: "under_allocated" });
    expect(calculateZeroBased(500000, [600000])).toMatchObject({ unallocated: -100000, state: "over_allocated" });
    expect(calculateZeroBased(0, [])).toMatchObject({ allocated: 0, state: "fully_allocated" });
  });
});

describe("calculateGoalProgress", () => {
  const today = "2026-10-01";

  it("reports progress without a deadline", () => {
    expect(calculateGoalProgress(100000, 25000, null, today)).toEqual({
      target: 100000,
      current: 25000,
      remaining: 75000,
      progressBps: 2500,
      isComplete: false,
      daysLeft: null,
      requiredWeekly: null,
      requiredBiweekly: null,
      requiredMonthly: null,
      isOverdue: false,
    });
  });

  it("computes required contributions rounded up so following them reaches the target", () => {
    const p = calculateGoalProgress(1200000, 0, "2027-10-01", today);
    expect(p).toMatchObject({ daysLeft: 365, remaining: 1200000, requiredWeekly: 23077, requiredBiweekly: 46154, requiredMonthly: 100076 });
    expect(p.requiredWeekly! * 52).toBeGreaterThanOrEqual(p.remaining);
    expect(p.requiredBiweekly! * 26).toBeGreaterThanOrEqual(p.remaining);
    // 365 days = 11.991 average months (30.4375 days each)
    expect(p.requiredMonthly! * 11991).toBeGreaterThanOrEqual(p.remaining * 1000);
  });

  it("asks for at least one contribution when less than a period is left", () => {
    expect(calculateGoalProgress(100000, 0, "2026-10-11", today)).toMatchObject({ daysLeft: 10, requiredWeekly: 100000, requiredBiweekly: 100000, requiredMonthly: 100000 });
    expect(calculateGoalProgress(100000, 0, "2026-11-15", today)).toMatchObject({ daysLeft: 45, requiredWeekly: 16667, requiredBiweekly: 33334, requiredMonthly: 67659 });
  });

  it("asks for the whole remainder on or after the deadline and flags overdue goals", () => {
    expect(calculateGoalProgress(100000, 40000, today, today)).toMatchObject({ daysLeft: 0, requiredMonthly: 60000, isOverdue: false });
    expect(calculateGoalProgress(100000, 40000, "2026-09-01", today)).toMatchObject({
      daysLeft: -30,
      requiredWeekly: 60000,
      requiredBiweekly: 60000,
      requiredMonthly: 60000,
      isOverdue: true,
    });
  });

  it("caps progress at 100% and needs nothing once complete, even past the deadline", () => {
    expect(calculateGoalProgress(100000, 120000, "2027-01-01", today)).toMatchObject({
      remaining: 0,
      progressBps: 10000,
      isComplete: true,
      daysLeft: 92,
      requiredWeekly: 0,
      requiredBiweekly: 0,
      requiredMonthly: 0,
    });
    expect(calculateGoalProgress(100000, 100000, "2026-01-01", today)).toMatchObject({ isComplete: true, isOverdue: false, requiredMonthly: 0 });
  });

  it("handles zero targets and negative balances", () => {
    expect(calculateGoalProgress(0, 0, null, today)).toMatchObject({ progressBps: 0, isComplete: false, remaining: 0 });
    expect(calculateGoalProgress(100000, -5000, null, today)).toMatchObject({ progressBps: 0, remaining: 105000 });
  });

  it("counts calendar days across a leap day", () => {
    expect(calculateGoalProgress(1000, 0, "2028-03-01", "2028-02-28").daysLeft).toBe(2);
    expect(calculateGoalProgress(1000, 0, "2027-03-01", "2027-02-28").daysLeft).toBe(1);
  });
});

describe("calculateGoalPace", () => {
  const today = "2026-10-01";
  const progress = calculateGoalProgress(1200000, 0, "2027-10-01", today);

  it("annualises the last 90 days of contributions into a monthly pace (window excludes its first day and the future)", () => {
    const pace = calculateGoalPace(
      progress,
      [
        { date: "2026-07-03", amount: 5000 }, // exactly 90 days ago: outside the window
        { date: "2026-07-04", amount: 30000 },
        { date: "2026-08-15", amount: 30000 },
        { date: "2026-10-01", amount: 30000 },
        { date: "2026-10-02", amount: 99999 }, // future
      ],
      today,
    );
    // 90000 over 90 days × 30.4375 days/month = 30437.5 → 30438
    expect(pace).toEqual({ currentMonthlyPace: 30438, requiredMonthlyPace: 100076, difference: 69638, onTrack: false, projectedCompletion: "2030-01-13" });
  });

  it("has no projection without contributions and never reports a negative pace", () => {
    expect(calculateGoalPace(progress, [], today)).toMatchObject({ currentMonthlyPace: 0, projectedCompletion: null, onTrack: false });
    expect(calculateGoalPace(progress, [{ date: "2026-09-01", amount: -50000 }], today).currentMonthlyPace).toBe(0);
  });

  it("is on track when the pace meets the requirement, and complete goals finish today", () => {
    const small = calculateGoalProgress(30000, 0, "2026-12-31", today);
    expect(calculateGoalPace(small, [{ date: "2026-09-15", amount: 90000 }], today).onTrack).toBe(true);
    const done = calculateGoalProgress(30000, 30000, null, today);
    expect(calculateGoalPace(done, [], today)).toMatchObject({ projectedCompletion: today, requiredMonthlyPace: null, difference: null, onTrack: null });
  });
});

describe("calculateSavingsRate", () => {
  it("returns (income − expenses) / income in basis points", () => {
    expect(calculateSavingsRate(500000, 400000)).toBe(2000);
    expect(calculateSavingsRate(500000, 600000)).toBe(-2000);
    expect(calculateSavingsRate(300000, 0)).toBe(10000);
  });

  it("is zero without income", () => {
    expect(calculateSavingsRate(0, 100)).toBe(0);
    expect(calculateSavingsRate(-5, 0)).toBe(0);
  });
});

describe("calculateNetWorth", () => {
  it("separates assets and liabilities by group", () => {
    const result = calculateNetWorth([
      { balance: 250000, class: "asset", group: "cash" },
      { balance: 1000000, class: "asset", group: "investments" },
      { balance: 45000, class: "liability", group: "creditCards" },
      { balance: 1500000, class: "liability", group: "loans" },
    ]);
    expect(result).toEqual({
      assets: 1250000,
      liabilities: 1545000,
      netWorth: -295000,
      breakdown: { cash: 250000, investments: 1000000, otherAssets: 0, creditCards: 45000, loans: 1500000, otherLiabilities: 0 },
    });
  });

  it("is zero for no accounts", () => {
    expect(calculateNetWorth([])).toMatchObject({ assets: 0, liabilities: 0, netWorth: 0 });
  });
});

describe("calculateSafeToSpend", () => {
  const base = { availableCash: 250000, upcomingBills: 80000, reservedBudget: 40000, plannedSavings: 25000, minimumBuffer: 50000 };

  it("subtracts every commitment from available cash and explains each line", () => {
    const result = calculateSafeToSpend(base);
    expect(result).toMatchObject({ safeToSpend: 55000, raw: 55000, shortfall: 0 });
    expect(result.lines.map((l) => [l.key, l.sign, l.amount])).toEqual([
      ["availableCash", 1, 250000],
      ["upcomingBills", -1, 80000],
      ["reservedBudget", -1, 40000],
      ["plannedSavings", -1, 25000],
      ["minimumBuffer", -1, 50000],
    ]);
    expect(result.lines.reduce((acc, l) => acc + l.sign * l.amount, 0)).toBe(result.raw);
  });

  it("floors at zero and reports the shortfall", () => {
    expect(calculateSafeToSpend({ ...base, availableCash: 100000, plannedSavings: 0 })).toMatchObject({ safeToSpend: 0, raw: -70000, shortfall: 70000 });
    expect(calculateSafeToSpend({ ...base, availableCash: 195000 })).toMatchObject({ safeToSpend: 0, raw: 0, shortfall: 0 });
  });
});

describe("calculateCashFlow", () => {
  const events: CashFlowEvent[] = [
    { date: "2026-10-02", amount: -60000, kind: "bill", label: "Rent" },
    { date: "2026-10-03", amount: 150000, kind: "income", label: "Payroll" },
    { date: "2026-10-05", amount: -1599, kind: "subscription", label: "Streaming" },
    { date: "2026-10-20", amount: -99999, kind: "bill", label: "Outside the window" },
  ];

  it("runs a daily balance with events and discretionary spending", () => {
    const result = calculateCashFlow(100000, events, "2026-10-01", 7, 1000);
    expect(result.days.map((d) => [d.date, d.balance])).toEqual([
      ["2026-10-01", 99000],
      ["2026-10-02", 38000],
      ["2026-10-03", 187000],
      ["2026-10-04", 186000],
      ["2026-10-05", 183401],
      ["2026-10-06", 182401],
      ["2026-10-07", 181401],
    ]);
    expect(result).toMatchObject({
      startingBalance: 100000,
      endingBalance: 181401,
      lowestBalance: 38000,
      lowestBalanceDate: "2026-10-02",
      totalInflow: 150000,
      totalOutflow: 68599,
      byKind: { income: 150000, bill: -60000, subscription: -1599, expense: -7000, goal: 0 },
    });
    expect(result.days[1]).toMatchObject({ inflow: 0, outflow: 61000 });
    expect(result.days[2]).toMatchObject({ inflow: 150000, outflow: 1000 });
  });

  it("keeps the starting balance as the low point when the balance never dips", () => {
    const result = calculateCashFlow(5000, [{ date: "2026-10-03", amount: 100, kind: "income", label: "Interest" }], "2026-10-01", 5);
    expect(result).toMatchObject({ lowestBalance: 5000, lowestBalanceDate: "2026-10-01", endingBalance: 5100 });
  });

  it("reports the first day of a repeated low point", () => {
    const result = calculateCashFlow(
      1000,
      [
        { date: "2026-10-02", amount: -500, kind: "bill", label: "A" },
        { date: "2026-10-03", amount: 500, kind: "income", label: "B" },
        { date: "2026-10-04", amount: -500, kind: "bill", label: "C" },
      ],
      "2026-10-01",
      5,
    );
    expect(result).toMatchObject({ lowestBalance: 500, lowestBalanceDate: "2026-10-02" });
  });

  it("returns no days for a zero-day horizon", () => {
    expect(calculateCashFlow(1234, events, "2026-10-01", 0, 1000)).toMatchObject({ days: [], endingBalance: 1234, lowestBalance: 1234, totalInflow: 0, totalOutflow: 0 });
  });

  it("walks calendar days across month ends and leap days", () => {
    expect(calculateCashFlow(0, [], "2026-01-30", 3).days.map((d) => d.date)).toEqual(["2026-01-30", "2026-01-31", "2026-02-01"]);
    expect(calculateCashFlow(0, [], "2028-02-28", 3).days.map((d) => d.date)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(calculateCashFlow(0, [], "2026-12-31", 2).days.map((d) => d.date)).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("can go negative and reports it as the lowest point", () => {
    const result = calculateCashFlow(10000, [{ date: "2026-10-01", amount: -25000, kind: "bill", label: "Rent" }], "2026-10-01", 2);
    expect(result).toMatchObject({ lowestBalance: -15000, lowestBalanceDate: "2026-10-01", endingBalance: -15000 });
  });
});

describe("averageCents / medianCents", () => {
  it("averages with half-away-from-zero rounding", () => {
    expect(averageCents([])).toBe(0);
    expect(averageCents([1, 2])).toBe(2);
    expect(averageCents([-1, -2])).toBe(-2);
    expect(averageCents([100, 200, 300])).toBe(200);
  });

  it("takes the middle value, averaging the two middle values for even counts", () => {
    expect(medianCents([])).toBe(0);
    expect(medianCents([5, 1, 3])).toBe(3);
    expect(medianCents([1, 2])).toBe(2);
    expect(medianCents([4, 1, 3, 2])).toBe(3);
    expect(medianCents([-10, 10])).toBe(0);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    medianCents(values);
    expect(values).toEqual([3, 1, 2]);
  });
});
