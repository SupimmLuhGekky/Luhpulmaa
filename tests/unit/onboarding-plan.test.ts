import { describe, expect, it } from "vitest";
import {
  INCOME_SPLIT_BPS,
  ONBOARDING_STEP_COUNT,
  SUGGESTED_SAVINGS_BPS,
  essentialMonthlyCents,
  monthlyToReach,
  progressAfter,
  resolveStep,
  roundToTenDollars,
  roundUpToHundredDollars,
  roundUpToTenDollars,
  stepKey,
  stepNumber,
  suggestBudget,
  suggestGoals,
  type SuggestionCategory,
} from "@/lib/users/onboarding-plan";

const cat = (id: string, systemKey: string | null, name = id, extra: Partial<SuggestionCategory> = {}): SuggestionCategory => ({ id, name, systemKey, kind: "EXPENSE", ...extra });

const CATEGORIES: SuggestionCategory[] = [
  cat("c-housing", "housing", "Housing"),
  cat("c-utilities", "utilities", "Utilities"),
  cat("c-groceries", "groceries", "Groceries"),
  cat("c-restaurants", "restaurants", "Restaurants"),
  cat("c-transportation", "transportation", "Transportation"),
  cat("c-shopping", "shopping", "Shopping"),
  cat("c-travel", "travel", "Travel", { isHidden: true }),
  cat("c-income", "income", "Income", { kind: "INCOME" }),
  cat("c-pets", null, "Pets"),
];

describe("onboarding steps", () => {
  it("has nine steps from welcome to done", () => {
    expect(ONBOARDING_STEP_COUNT).toBe(9);
    expect(stepKey(1)).toBe("welcome");
    expect(stepKey(9)).toBe("done");
    expect(stepNumber("budget")).toBe(6);
  });

  it("resumes at the furthest step reached and never skips ahead", () => {
    expect(resolveStep(undefined, 0)).toBe(1);
    expect(resolveStep(undefined, 5)).toBe(5);
    expect(resolveStep("3", 5)).toBe(3);
    expect(resolveStep("8", 5)).toBe(5);
    expect(resolveStep(["2", "4"], 5)).toBe(2);
    expect(resolveStep("0", 5)).toBe(1);
    expect(resolveStep("abc", 4)).toBe(4);
    expect(resolveStep("-2", 4)).toBe(4);
    expect(resolveStep(undefined, 42)).toBe(9);
  });

  it("only moves progress forward", () => {
    expect(progressAfter(1, 0)).toBe(2);
    expect(progressAfter(3, 6)).toBe(6);
    expect(progressAfter(8, 8)).toBe(9);
    expect(progressAfter(9, 9)).toBe(9);
  });
});

describe("rounding helpers", () => {
  it("rounds to the nearest $10", () => {
    expect(roundToTenDollars(123_449)).toBe(123_000);
    expect(roundToTenDollars(123_500)).toBe(124_000);
    expect(roundToTenDollars(0)).toBe(0);
    expect(roundToTenDollars(-500)).toBe(0);
  });

  it("rounds up to the next $10 and $100", () => {
    expect(roundUpToTenDollars(4320)).toBe(5000);
    expect(roundUpToTenDollars(5000)).toBe(5000);
    expect(roundUpToHundredDollars(512_001)).toBe(520_000);
    expect(roundUpToHundredDollars(0)).toBe(0);
  });
});

describe("suggestBudget", () => {
  it("leaves 20% of income for savings in the split", () => {
    expect(SUGGESTED_SAVINGS_BPS).toBe(2000);
    expect(Object.values(INCOME_SPLIT_BPS).every((v) => Number.isInteger(v) && v > 0)).toBe(true);
  });

  it("splits income across visible built-in expense categories", () => {
    const s = suggestBudget({ monthlyIncomeCents: 400_000, categories: CATEGORIES });
    expect(s.basis).toBe("income");
    const byName = Object.fromEntries(s.lines.map((l) => [l.name, l.amountCents]));
    expect(byName).toEqual({ Housing: 112_000, Utilities: 20_000, Groceries: 40_000, Transportation: 16_000, Restaurants: 24_000, Shopping: 28_000 });
    // Hidden, income and custom categories are not suggested.
    expect(s.lines.some((l) => l.name === "Travel" || l.name === "Income" || l.name === "Pets")).toBe(false);
    expect(s.totalCents).toBe(240_000);
    expect(s.leftoverCents).toBe(160_000);
    expect(s.lines.every((l) => Number.isInteger(l.amountCents) && l.amountCents % 1000 === 0)).toBe(true);
  });

  it("marks essential lines", () => {
    const s = suggestBudget({ monthlyIncomeCents: 400_000, categories: CATEGORIES });
    expect(s.lines.find((l) => l.name === "Housing")?.essential).toBe(true);
    expect(s.lines.find((l) => l.name === "Shopping")?.essential).toBe(false);
    expect(essentialMonthlyCents(s.lines)).toBe(112_000 + 20_000 + 40_000 + 16_000);
  });

  it("prefers the person's own average spending when there is enough history", () => {
    const s = suggestBudget({
      monthlyIncomeCents: 400_000,
      categories: CATEGORIES,
      averageSpending: { "c-groceries": 51_234, "c-restaurants": 18_001, "c-pets": 4_320, "c-travel": 90_000, "c-income": 10 },
    });
    expect(s.basis).toBe("history");
    expect(s.lines.map((l) => [l.name, l.amountCents])).toEqual([
      ["Groceries", 52_000],
      ["Restaurants", 19_000],
      ["Pets", 5_000],
    ]);
    expect(s.lines[0].averageCents).toBe(51_234);
    expect(s.leftoverCents).toBe(400_000 - 76_000);
  });

  it("falls back to income when history is too thin, and to nothing without income", () => {
    expect(suggestBudget({ monthlyIncomeCents: 300_000, categories: CATEGORIES, averageSpending: { "c-groceries": 40_000 } }).basis).toBe("income");
    const none = suggestBudget({ monthlyIncomeCents: null, categories: CATEGORIES });
    expect(none).toEqual({ basis: "none", lines: [], totalCents: 0, leftoverCents: null });
  });
});

describe("suggestGoals", () => {
  it("derives an emergency fund from essential expenses", () => {
    const [emergency] = suggestGoals({ essentialMonthlyCents: 188_050 });
    expect(emergency.key).toBe("emergency");
    expect(emergency.targetCents).toBe(570_000);
  });

  it("never invents a target without the person's numbers", () => {
    const goals = suggestGoals({ essentialMonthlyCents: null });
    expect(goals.every((g) => g.targetCents === null)).toBe(true);
  });
});

describe("monthly amount to reach a goal", () => {
  it("divides what's left by the whole months until the deadline", () => {
    expect(monthlyToReach({ targetCents: 1_200_000, today: "2026-10-01", deadline: "2027-10-01" })).toEqual({ months: 12, monthlyCents: 100_000 });
    expect(monthlyToReach({ targetCents: 1_200_000, savedCents: 300_000, today: "2026-10-01", deadline: "2027-10-01" })).toEqual({ months: 12, monthlyCents: 75_000 });
  });

  it("doesn't count a partial last month and rounds up to the cent", () => {
    // Oct 20 → Jan 10 is two whole months.
    expect(monthlyToReach({ targetCents: 100_001, today: "2026-10-20", deadline: "2027-01-10" })).toEqual({ months: 2, monthlyCents: 50_001 });
    // Less than a month away: everything this month.
    expect(monthlyToReach({ targetCents: 50_000, today: "2026-10-01", deadline: "2026-10-15" })).toEqual({ months: 1, monthlyCents: 50_000 });
  });

  it("needs a future deadline and reports goals already reached", () => {
    expect(monthlyToReach({ targetCents: 50_000, today: "2026-10-01", deadline: null })).toBeNull();
    expect(monthlyToReach({ targetCents: 50_000, today: "2026-10-01", deadline: "2026-10-01" })).toBeNull();
    expect(monthlyToReach({ targetCents: 50_000, today: "2026-10-01", deadline: "2026-09-01" })).toBeNull();
    expect(monthlyToReach({ targetCents: 50_000, savedCents: 60_000, today: "2026-10-01", deadline: "2027-01-01" })).toEqual({ months: 0, monthlyCents: 0 });
  });
});
