import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { addDays, todayIn } from "@/lib/dates";
import { listCategories } from "@/lib/categories/service";
import { goalAccountOptions, listGoals } from "@/lib/goals/service";
import { expectedPaydays, listAllocationPlans, listIncomeSources } from "@/lib/income/service";
import { IncomeScreen } from "@/components/income/income-screen";

export const metadata: Metadata = { title: "Income" };

const HORIZON_DAYS = 60;

/** /income — income sources and paydays (estimates), and paycheque plans that record planned allocations. */
export default async function IncomePage() {
  const user = await requireOnboardedUser();
  const today = todayIn(user.timeZone);
  const [income, paydays, plans, goals, categories, accounts] = await Promise.all([
    listIncomeSources(user.id, user.timeZone),
    expectedPaydays(user.id, today, addDays(today, HORIZON_DAYS - 1)),
    listAllocationPlans(user.id),
    listGoals(user.id, { includeArchived: true }),
    listCategories(user.id),
    goalAccountOptions(user.id),
  ]);
  return (
    <IncomeScreen
      sources={income.sources}
      totals={income.totals}
      paydays={paydays}
      horizonDays={HORIZON_DAYS}
      plans={plans}
      goals={goals.filter((g) => g.status !== "COMPLETED" || plans.some((p) => p.items.some((i) => i.goal?.id === g.id))).map((g) => ({ id: g.id, name: g.name, archived: g.status === "ARCHIVED" }))}
      categories={categories.filter((c) => c.kind === "EXPENSE" && !c.isHidden).map((c) => ({ id: c.id, name: c.name }))}
      accounts={accounts}
    />
  );
}
