/**
 * Pure onboarding logic: the step list, resuming where the person left off, and the
 * suggested first budget and savings goal. Client-safe and unit-tested.
 *
 * Suggestions are starting points the person edits before anything is saved; they are
 * derived only from what the person entered (income) or their own transactions.
 */
import { ESSENTIAL_CATEGORY_KEYS } from "@/lib/categories/defaults";
import { percentOf, type Cents } from "@/lib/finance/money";

export const ONBOARDING_STEPS = [
  { key: "welcome", label: "Welcome", optional: false },
  { key: "profile", label: "Profile & region", optional: false },
  { key: "goals", label: "What matters to you", optional: false },
  { key: "income", label: "Income", optional: true },
  { key: "accounts", label: "Accounts", optional: true },
  { key: "budget", label: "First budget", optional: true },
  { key: "goal", label: "Savings goal", optional: true },
  { key: "notifications", label: "Notifications", optional: true },
  { key: "done", label: "All set", optional: false },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];
export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

/** 1-based step number of a step key. */
export function stepNumber(key: OnboardingStepKey): number {
  return ONBOARDING_STEPS.findIndex((s) => s.key === key) + 1;
}

export function stepKey(step: number): OnboardingStepKey {
  return ONBOARDING_STEPS[clampStep(step) - 1].key;
}

export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 1;
  return Math.min(ONBOARDING_STEP_COUNT, Math.max(1, Math.trunc(step)));
}

/**
 * The step to show. `stored` is the furthest step reached (User.onboardingStep, 0 for a
 * new account). Without a requested step the person resumes where they left off; they
 * can go back to any earlier step but never jump past the furthest one reached.
 */
export function resolveStep(requested: string | string[] | undefined, stored: number): number {
  const furthest = clampStep(stored);
  const raw = Array.isArray(requested) ? requested[0] : requested;
  if (raw === undefined || raw === "" || !/^\d{1,2}$/.test(raw)) return furthest;
  return Math.min(furthest, clampStep(Number(raw)));
}

/** Stored progress after finishing `step`: moves forward only. */
export function progressAfter(step: number, stored: number): number {
  return Math.max(clampStep(stored), clampStep(step + 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggested first budget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Share of monthly income suggested per built-in category, in basis points. Needs come
 * to 53%, wants to 27%, which leaves 20% unbudgeted for savings and goals.
 */
export const INCOME_SPLIT_BPS: Record<string, number> = {
  housing: 2800,
  utilities: 500,
  groceries: 1000,
  transportation: 400,
  gas: 300,
  insurance: 200,
  healthcare: 100,
  restaurants: 600,
  shopping: 700,
  entertainment: 400,
  subscriptions: 300,
  personal: 400,
  travel: 300,
};

/** Share of income the suggested split leaves for savings (bps). */
export const SUGGESTED_SAVINGS_BPS = 10000 - Object.values(INCOME_SPLIT_BPS).reduce((a, b) => a + b, 0);

/** At least this many categories with spending make history a usable basis. */
export const MIN_HISTORY_CATEGORIES = 3;
const MAX_HISTORY_LINES = 14;

export interface SuggestionCategory {
  id: string;
  name: string;
  systemKey: string | null;
  kind: string;
  isHidden?: boolean;
  icon?: string | null;
  color?: string | null;
}

export interface BudgetSuggestionLine {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  amountCents: Cents;
  essential: boolean;
  /** Average monthly spending over the history window, when known. */
  averageCents: Cents | null;
}

export interface BudgetSuggestion {
  basis: "history" | "income" | "none";
  lines: BudgetSuggestionLine[];
  totalCents: Cents;
  /** Monthly income minus the suggested lines (null without income). */
  leftoverCents: Cents | null;
}

/** Rounds to the nearest $10 (half up). */
export function roundToTenDollars(cents: Cents): Cents {
  if (cents <= 0) return 0;
  const r = cents % 1000;
  return r >= 500 ? cents - r + 1000 : cents - r;
}

/** Rounds up to the next $10 (an average of $43.20 becomes $50). */
export function roundUpToTenDollars(cents: Cents): Cents {
  if (cents <= 0) return 0;
  return Math.ceil(cents / 1000) * 1000;
}

/**
 * Suggests budget lines for the first month: from the person's own average spending
 * when there is enough history, otherwise from a share of the income they entered.
 * Only visible expense categories are used.
 */
export function suggestBudget(input: {
  monthlyIncomeCents: Cents | null;
  categories: SuggestionCategory[];
  /** Average monthly spending per category id over recent full months. */
  averageSpending?: Record<string, Cents>;
}): BudgetSuggestion {
  const expense = input.categories.filter((c) => c.kind === "EXPENSE" && !c.isHidden);
  const essential = (c: SuggestionCategory) => Boolean(c.systemKey && ESSENTIAL_CATEGORY_KEYS.has(c.systemKey));
  const income = input.monthlyIncomeCents && input.monthlyIncomeCents > 0 ? input.monthlyIncomeCents : null;
  const avg = input.averageSpending ?? {};

  const withHistory = expense.filter((c) => (avg[c.id] ?? 0) > 0);
  let lines: BudgetSuggestionLine[];
  let basis: BudgetSuggestion["basis"];
  if (withHistory.length >= MIN_HISTORY_CATEGORIES) {
    basis = "history";
    lines = withHistory
      .map((c) => ({ categoryId: c.id, name: c.name, icon: c.icon ?? null, color: c.color ?? null, amountCents: roundUpToTenDollars(avg[c.id]), essential: essential(c), averageCents: avg[c.id] }))
      .sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name))
      .slice(0, MAX_HISTORY_LINES);
  } else if (income) {
    basis = "income";
    lines = [];
    for (const [key, bps] of Object.entries(INCOME_SPLIT_BPS)) {
      const c = expense.find((x) => x.systemKey === key);
      if (!c) continue;
      const amountCents = roundToTenDollars(percentOf(income, bps));
      if (amountCents <= 0) continue;
      lines.push({ categoryId: c.id, name: c.name, icon: c.icon ?? null, color: c.color ?? null, amountCents, essential: essential(c), averageCents: (avg[c.id] ?? 0) > 0 ? avg[c.id] : null });
    }
  } else {
    basis = "none";
    lines = [];
  }
  const totalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  return { basis, lines, totalCents, leftoverCents: income === null ? null : income - totalCents };
}

/** Sum of the essential lines (housing, utilities, groceries…) of a budget. */
export function essentialMonthlyCents(lines: Pick<BudgetSuggestionLine, "amountCents" | "essential">[]): Cents {
  return lines.filter((l) => l.essential).reduce((a, l) => a + l.amountCents, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggested first savings goal
// ─────────────────────────────────────────────────────────────────────────────

export interface GoalSuggestion {
  key: string;
  name: string;
  icon: string;
  color: string;
  /** Prefilled target, only when it can be derived from the person's own numbers. */
  targetCents: Cents | null;
  hint: string;
}

/** Months of essential expenses suggested for an emergency fund. */
export const EMERGENCY_FUND_MONTHS = 3;

/** Rounds up to the next $100. */
export function roundUpToHundredDollars(cents: Cents): Cents {
  if (cents <= 0) return 0;
  return Math.ceil(cents / 10000) * 10000;
}

export function suggestGoals(input: { essentialMonthlyCents: Cents | null }): GoalSuggestion[] {
  const essentials = input.essentialMonthlyCents && input.essentialMonthlyCents > 0 ? input.essentialMonthlyCents : null;
  return [
    {
      key: "emergency",
      name: "Emergency fund",
      icon: "shield",
      color: "#14b8a6",
      targetCents: essentials ? roundUpToHundredDollars(essentials * EMERGENCY_FUND_MONTHS) : null,
      hint: essentials ? `About ${EMERGENCY_FUND_MONTHS} months of your essential expenses.` : `Often ${EMERGENCY_FUND_MONTHS}–6 months of essential expenses.`,
    },
    { key: "vacation", name: "Vacation", icon: "plane", color: "#06b6d4", targetCents: null, hint: "A trip you're planning." },
    { key: "car", name: "Car", icon: "car", color: "#0ea5e9", targetCents: null, hint: "A down payment or a full purchase." },
    { key: "home", name: "Home down payment", icon: "home", color: "#6366f1", targetCents: null, hint: "Saving toward a first home." },
    { key: "education", name: "Education", icon: "graduation-cap", color: "#3b82f6", targetCents: null, hint: "Courses, tuition or a program." },
  ];
}
