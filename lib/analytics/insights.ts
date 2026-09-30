import "server-only";
import { formatBps, formatCurrency, type Cents } from "@/lib/finance/money";
import type { LocalDate } from "@/lib/dates";

/**
 * Factual spending insights. Every insight is a CALCULATION over the user's own data
 * (kind: "fact"). No advice is generated here; the UI labels these as observations.
 */
export interface Insight {
  id: string;
  kind: "fact";
  tone: "neutral" | "positive" | "attention";
  text: string;
  /** How the number was computed, shown on hover/expand. */
  basis: string;
}

interface InsightInput {
  range: { from: LocalDate; to: LocalDate; previousFrom: LocalDate; previousTo: LocalDate; label: string };
  metrics: {
    income: Cents;
    spending: Cents;
    averageDailySpending: Cents;
    recurringMonthly: Cents;
    subscriptionsMonthly: Cents;
    savingsRateBps: number;
    previous: { income: Cents; spending: Cents };
  };
  categoryBreakdown: { name: string; spending: Cents; previous: Cents; shareBps: number }[];
  today: LocalDate;
}

export async function generateInsights(_userId: string, input: InsightInput): Promise<Insight[]> {
  const out: Insight[] = [];
  const { metrics, categoryBreakdown, range } = input;
  const period = range.label.toLowerCase().replace("this ", "this ");
  const prevLabel = range.label === "This month" ? "last month" : "the previous period";

  // Largest category change vs previous period (same number of days).
  const changes = categoryBreakdown
    .filter((c) => c.previous > 0 || c.spending > 0)
    .map((c) => ({ ...c, delta: c.spending - c.previous }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = changes[0];
  if (top && Math.abs(top.delta) >= 2_000) {
    out.push({
      id: "category-change",
      kind: "fact",
      tone: top.delta > 0 ? "attention" : "positive",
      text: `You spent ${formatCurrency(Math.abs(top.delta), { wholeDollars: true })} ${top.delta > 0 ? "more" : "less"} on ${top.name.toLowerCase()} ${period} than ${prevLabel}.`,
      basis: `${top.name}: ${formatCurrency(top.spending)} (${range.from} → ${range.to}) vs ${formatCurrency(top.previous)} (${range.previousFrom} → ${range.previousTo}).`,
    });
  }
  const biggest = categoryBreakdown[0];
  if (biggest && metrics.spending > 0) {
    out.push({
      id: "category-share",
      kind: "fact",
      tone: "neutral",
      text: `${biggest.name} represents ${formatBps(biggest.shareBps, 0)} of your spending ${period}.`,
      basis: `${formatCurrency(biggest.spending)} of ${formatCurrency(metrics.spending)} total spending.`,
    });
  }
  const transport = categoryBreakdown.find((c) => c.name.toLowerCase() === "transportation");
  if (transport && transport !== biggest && metrics.spending > 0) {
    out.push({ id: "transport-share", kind: "fact", tone: "neutral", text: `Transportation represents ${formatBps(transport.shareBps, 0)} of your spending.`, basis: `${formatCurrency(transport.spending)} of ${formatCurrency(metrics.spending)}.` });
  }
  if (metrics.recurringMonthly > 0) {
    out.push({
      id: "recurring",
      kind: "fact",
      tone: "neutral",
      text: `Your recurring expenses total approximately ${formatCurrency(metrics.recurringMonthly, { wholeDollars: true })}/month.`,
      basis: "Sum of detected recurring outflows converted to a monthly amount (weekly × 52 / 12, biweekly × 26 / 12, …).",
    });
  }
  if (metrics.averageDailySpending > 0) {
    out.push({
      id: "weekly-average",
      kind: "fact",
      tone: "neutral",
      text: `Your average weekly spending is ${formatCurrency(metrics.averageDailySpending * 7, { wholeDollars: true })}.`,
      basis: `Average daily spending ${formatCurrency(metrics.averageDailySpending)} × 7, over ${range.from} → ${range.to}.`,
    });
  }
  if (metrics.income > 0) {
    out.push({
      id: "savings-rate",
      kind: "fact",
      tone: metrics.savingsRateBps >= 0 ? "positive" : "attention",
      text: metrics.savingsRateBps >= 0 ? `You kept ${formatBps(metrics.savingsRateBps, 0)} of your income ${period}.` : `Spending exceeded income by ${formatCurrency(metrics.spending - metrics.income, { wholeDollars: true })} ${period}.`,
      basis: `(Income ${formatCurrency(metrics.income)} − spending ${formatCurrency(metrics.spending)}) ÷ income. Transfers are excluded.`,
    });
  }
  if (metrics.subscriptionsMonthly > 0) {
    out.push({
      id: "subscriptions",
      kind: "fact",
      tone: "neutral",
      text: `Subscriptions cost ${formatCurrency(metrics.subscriptionsMonthly)}/month, about ${formatCurrency(metrics.subscriptionsMonthly * 12, { wholeDollars: true })} a year.`,
      basis: "Active subscriptions converted to monthly and annual amounts.",
    });
  }
  return out;
}
