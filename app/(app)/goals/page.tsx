import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { goalAccountOptions, listGoalItems } from "@/lib/goals/service";
import { userPreferences } from "@/lib/settings/preferences";
import { GoalsScreen } from "@/components/goals/goals-screen";

export const metadata: Metadata = { title: "Goals" };

/** /goals — every goal with progress (actual and planned kept apart). ?new=1 opens "New goal". */
export default async function GoalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const [goals, accounts, prefs] = await Promise.all([listGoalItems(user.id, user.timeZone), goalAccountOptions(user.id), userPreferences(user.id)]);
  return <GoalsScreen goals={goals} accounts={accounts} contributionKind={prefs.goalContributionKind} openNew={params.new === "1"} />;
}
