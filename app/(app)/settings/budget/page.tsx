import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { getProfile } from "@/lib/users/service";
import { BudgetPreferencesForm } from "@/components/settings/budget-preferences-form";
import { SettingsPageHeader } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Budget · Settings" };

export default async function BudgetSettingsPage() {
  const user = await requireOnboardedUser();
  const profile = await getProfile(user.id);
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Budget"
        description={
          <>
            Defaults for new budget lines and how safe-to-spend is worked out. To change this month&apos;s amounts, go to{" "}
            <Link href="/budget" className="font-medium text-primary underline-offset-4 hover:underline">
              Budget
            </Link>
            .
          </>
        }
      />
      <BudgetPreferencesForm
        initial={{
          budgetAlertThresholds: profile.preferences.budgetAlertThresholds,
          budgetRolloverDefault: profile.preferences.budgetRolloverDefault,
          budgetMode: profile.budgetMode,
          monthlyIncomeTargetCents: profile.monthlyIncomeTargetCents,
          minCashBufferCents: profile.minCashBufferCents,
          includeSavingsInSafeToSpend: profile.preferences.includeSavingsInSafeToSpend,
        }}
      />
    </div>
  );
}
