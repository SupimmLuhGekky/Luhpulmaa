import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { COMMON_TIME_ZONES, todayIn } from "@/lib/dates";
import { isEnabled } from "@/lib/flags";
import { getProfile } from "@/lib/users/service";
import { RegionForm } from "@/components/settings/region-form";
import { SettingsPageHeader } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Currency & region · Settings" };

export default async function RegionSettingsPage() {
  const user = await requireOnboardedUser();
  const profile = await getProfile(user.id);
  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Currency & region" description="Canadian dollars and Canadian formatting by default, with French-friendly number and date formats." />
      <RegionForm
        initial={{ currency: profile.currency, locale: profile.locale, timeZone: profile.timeZone, weekStartsOn: profile.weekStartsOn }}
        timeZones={[...COMMON_TIME_ZONES]}
        today={todayIn(profile.timeZone)}
        multiCurrency={isEnabled("ENABLE_MULTI_CURRENCY")}
      />
    </div>
  );
}
