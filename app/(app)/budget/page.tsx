import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { todayIn } from "@/lib/dates";
import { budgetDefaults, budgetHistory, budgetView, findBudget, listBudgets } from "@/lib/budget/service";
import { parsePeriodParams } from "@/lib/budget/periods";
import { BudgetScreen } from "@/components/budget/budget-screen";

export const metadata: Metadata = { title: "Budget" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * /budget — monthly (default), weekly and custom budgets.
 * ?month=YYYY-MM · ?period=weekly&week=YYYY-MM-DD · ?period=custom&id=… · ?new=1 opens "New budget".
 */
export default async function BudgetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const today = todayIn(user.timeZone);
  const [defaults, budgets] = await Promise.all([budgetDefaults(user.id), listBudgets(user.id)]);
  const selection = parsePeriodParams(params, today, defaults.weekStartsOn);

  let budgetId: string | null = null;
  if (selection.period === "CUSTOM") {
    const custom = budgets.filter((b) => b.period === "CUSTOM");
    budgetId = (selection.id && custom.find((b) => b.id === selection.id)?.id) || custom[0]?.id || null;
  } else if (selection.start) {
    budgetId = (await findBudget(user.id, selection.period, selection.start))?.id ?? null;
  }

  const view = budgetId ? await budgetView(user.id, budgetId) : null;
  const history = view && selection.period !== "CUSTOM" ? await budgetHistory(user.id, selection.period, view.budget.start, 6) : [];
  const openNew = params.new === "1";

  return <BudgetScreen selection={selection} view={view} history={history} budgets={budgets} defaults={defaults} openNew={openNew} />;
}
