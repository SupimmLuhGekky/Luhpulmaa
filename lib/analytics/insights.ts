import "server-only";
import { formatBps, formatCurrency, type Cents } from "@/lib/finance/money";
import { daysBetween, type LocalDate } from "@/lib/dates";

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
  range: {
    from: LocalDate;
    to: LocalDate;
    previousFrom: LocalDate;
    previousTo: LocalDate;
    label: string;
    /** "this month", "in this period" (derived from `label` when absent). */
    periodPhrase?: string;
    /** "the same days last month", "the previous 14 days"… */
    comparisonLabel?: string;
  };
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
  /** Categories with spending in either period (defaults to the breakdown). */
  categoryChanges?: { name: string; spending: Cents; previous: Cents }[];
  today: LocalDate;
  /** True when the figures only cover some accounts or categories. */
  scoped?: boolean;
  /** False when there is no data for the previous period (no change insight then). */
  comparable?: boolean;
  /** First day the history covers when it starts inside the range (averages use it). */
  coveredFrom?: LocalDate;
}

export async function generateInsights(_userId: string, input: InsightInput): Promise<Insight[]> {
  const out: Insight[] = [];
  const { metrics, categoryBreakdown, range } = input;
  const period = range.periodPhrase ?? (range.label.startsWith("This ") ? range.label.toLowerCase() : "in this period");
  const prevLabel = range.comparisonLabel ?? (range.label === "This month" ? "last month" : "the previous period");
  const spendingNoun = input.scoped ? "spending in this selection" : "your spending";
  const coveredFrom = input.coveredFrom && input.coveredFrom > range.from ? input.coveredFrom : range.from;
  const days = daysBetween(coveredFrom, range.to) + 1;
  // Recurring and subscription totals don't follow account or category filters: say so in the sentence.
  const allAccounts = input.scoped ? "Across all your accounts, " : "";

  // Largest category change vs the previous period.
  const changes = (input.categoryChanges ?? categoryBreakdown)
    .filter((c) => c.previous > 0 || c.spending > 0)
    .map((c) => ({ ...c, delta: c.spending - c.previous }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = changes[0];
  if (top && Math.abs(top.delta) >= 2_000 && input.comparable !== false) {
    out.push({
      id: "category-change",
      kind: "fact",
      tone: top.delta > 0 ? "attention" : "positive",
      text: `You spent ${formatCurrency(Math.abs(top.delta), { wholeDollars: true })} ${top.delta > 0 ? "more" : "less"} on ${top.name.toLowerCase()} ${period} than ${prevLabel}.`,
      basis: `${top.name}: ${formatCurrency(top.spending)} (${range.from} → ${range.to}) vs ${formatCurrency(top.previous)} (${range.previousFrom} → ${range.previousTo}).`,
    });
  }
  // A share is only informative when there is more than one category to compare.
  const biggest = categoryBreakdown.length > 1 ? categoryBreakdown[0] : undefined;
  if (biggest && metrics.spending > 0) {
    out.push({
      id: "category-share",
      kind: "fact",
      tone: "neutral",
      text: `${biggest.name} represents ${formatBps(biggest.shareBps, 0)} of ${spendingNoun} ${period}.`,
      basis: `${formatCurrency(biggest.spending)} of ${formatCurrency(metrics.spending)} total spending.`,
    });
  }
  const transport = categoryBreakdown.find((c) => c.name.toLowerCase() === "transportation");
  if (transport && biggest && transport !== biggest && metrics.spending > 0) {
    out.push({ id: "transport-share", kind: "fact", tone: "neutral", text: `Transportation represents ${formatBps(transport.shareBps, 0)} of ${spendingNoun} ${period}.`, basis: `${formatCurrency(transport.spending)} of ${formatCurrency(metrics.spending)}.` });
  }
  if (metrics.recurringMonthly > 0) {
    out.push({
      id: "recurring",
      kind: "fact",
      tone: "neutral",
      text: `${allAccounts}${input.scoped ? "recurring" : "Your recurring"} expenses total approximately ${formatCurrency(metrics.recurringMonthly, { wholeDollars: true })}/month.`,
      basis: `Sum of detected recurring outflows converted to a monthly amount (weekly × 52 / 12, biweekly × 26 / 12, …)${input.scoped ? ", across all accounts" : ""}.`,
    });
  }
  // A weekly figure from fewer than 7 days of data would be an extrapolation.
  if (metrics.averageDailySpending > 0 && days >= 7) {
    out.push({
      id: "weekly-average",
      kind: "fact",
      tone: "neutral",
      text: `${input.scoped ? "Average weekly spending in this selection" : "Your average weekly spending"} ${period} is ${formatCurrency(metrics.averageDailySpending * 7, { wholeDollars: true })}.`,
      basis: `Average daily spending ${formatCurrency(metrics.averageDailySpending)} × 7, over ${coveredFrom} → ${range.to}${coveredFrom > range.from ? " (your transactions start on that day)" : ""}.`,
    });
  }
  if (metrics.income > 0) {
    out.push({
      id: "savings-rate",
      kind: "fact",
      tone: metrics.savingsRateBps >= 0 ? "positive" : "attention",
      text:
        metrics.savingsRateBps >= 0
          ? `${input.scoped ? "In this selection, you kept" : "You kept"} ${formatBps(metrics.savingsRateBps, 0)} of your income ${period}.`
          : `${input.scoped ? "In this selection, spending" : "Spending"} exceeded income by ${formatCurrency(metrics.spending - metrics.income, { wholeDollars: true })} ${period}.`,
      basis: `(Income ${formatCurrency(metrics.income)} − spending ${formatCurrency(metrics.spending)}) ÷ income. Transfers are excluded.`,
    });
  }
  if (metrics.subscriptionsMonthly > 0) {
    out.push({
      id: "subscriptions",
      kind: "fact",
      tone: "neutral",
      text: `${allAccounts}${input.scoped ? "subscriptions" : "Subscriptions"} cost ${formatCurrency(metrics.subscriptionsMonthly)}/month, about ${formatCurrency(metrics.subscriptionsMonthly * 12, { wholeDollars: true })} a year.`,
      basis: `Active subscriptions converted to monthly and annual amounts${input.scoped ? ", across all accounts" : ""}.`,
    });
  }
  return out;
}
