import { describe, expect, it } from "vitest";
import { generateInsights } from "@/lib/analytics/insights";
import { resolveRange } from "@/lib/analytics/range";

const metrics = {
  income: 400_000,
  spending: 300_000,
  averageDailySpending: 10_000,
  recurringMonthly: 150_000,
  subscriptionsMonthly: 5_000,
  savingsRateBps: 2_500,
  previous: { income: 380_000, spending: 320_000 },
};

const breakdown = [
  { name: "Housing", spending: 150_000, previous: 150_000, shareBps: 5_000 },
  { name: "Groceries", spending: 60_000, previous: 90_000, shareBps: 2_000 },
  { name: "Transportation", spending: 30_000, previous: 25_000, shareBps: 1_000 },
];

describe("generateInsights", () => {
  it("states facts with the period and what it is compared with", async () => {
    const range = resolveRange({ range: "month" }, "2026-09-30");
    const out = await generateInsights("u", { range, metrics, categoryBreakdown: breakdown, today: "2026-09-30" });
    const text = Object.fromEntries(out.map((i) => [i.id, i.text]));
    expect(text["category-change"]).toBe("You spent $300 less on groceries this month than the same days last month.");
    expect(text["category-share"]).toBe("Housing represents 50% of your spending this month.");
    expect(text["savings-rate"]).toBe("You kept 25% of your income this month.");
    expect(out.every((i) => i.kind === "fact")).toBe(true);
  });

  it("reads naturally for a custom range", async () => {
    const range = resolveRange({ range: "custom", from: "2026-09-01", to: "2026-09-14" }, "2026-09-30");
    const out = await generateInsights("u", { range, metrics, categoryBreakdown: breakdown, today: "2026-09-30" });
    const change = out.find((i) => i.id === "category-change")!;
    expect(change.text).toBe("You spent $300 less on groceries in this period than the previous 14 days.");
    expect(out.map((i) => i.text).join(" ")).not.toMatch(/custom range/i);
  });

  it("uses categories that dropped to zero when choosing the biggest change", async () => {
    const range = resolveRange({ range: "month" }, "2026-09-30");
    const changes = [...breakdown, { name: "Travel", spending: 0, previous: 120_000 }];
    const out = await generateInsights("u", { range, metrics, categoryBreakdown: breakdown, categoryChanges: changes, today: "2026-09-30" });
    expect(out.find((i) => i.id === "category-change")!.text).toBe("You spent $1,200 less on travel this month than the same days last month.");
  });

  it("qualifies figures that only cover a selection and skips trivial shares", async () => {
    const range = resolveRange({ range: "month" }, "2026-09-30");
    const one = [{ name: "Groceries", spending: 60_000, previous: 90_000, shareBps: 10_000 }];
    const out = await generateInsights("u", { range, metrics: { ...metrics, spending: 60_000 }, categoryBreakdown: one, today: "2026-09-30", scoped: true });
    const ids = out.map((i) => i.id);
    expect(ids).not.toContain("category-share");
    expect(out.find((i) => i.id === "savings-rate")!.text).toMatch(/^In this selection, you kept/);
    expect(out.find((i) => i.id === "recurring")!.basis).toMatch(/across all accounts/);
  });

  it("does not extrapolate a weekly average from less than a week of data", async () => {
    const range = resolveRange({ range: "custom", from: "2026-09-28", to: "2026-09-30" }, "2026-09-30");
    const out = await generateInsights("u", { range, metrics, categoryBreakdown: breakdown, today: "2026-09-30" });
    expect(out.map((i) => i.id)).not.toContain("weekly-average");
  });
});
