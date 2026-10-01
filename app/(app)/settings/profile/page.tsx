import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { COMMON_TIME_ZONES, todayIn } from "@/lib/dates";
import { isEnabled } from "@/lib/flags";
import { CANADIAN_PROVINCES, getProfile } from "@/lib/users/service";
import { ProfileForm } from "@/components/settings/profile-form";
import { RegionForm } from "@/components/settings/region-form";
import { SettingsPageHeader } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Profile · Settings" };

export default async function ProfileSettingsPage() {
  const user = await requireOnboardedUser();
  const profile = await getProfile(user.id);
  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Profile" description="Your personal details and where you are." />
      <ProfileForm
        profile={{ firstName: profile.firstName, lastName: profile.lastName, email: profile.email, emailVerified: profile.emailVerified, country: profile.country, province: profile.province, isDemo: profile.isDemo }}
        provinces={CANADIAN_PROVINCES.map((p) => ({ code: p.code, name: p.name }))}
      />
      <RegionForm
        variant="profile"
        initial={{ currency: profile.currency, locale: profile.locale, timeZone: profile.timeZone, weekStartsOn: profile.weekStartsOn }}
        timeZones={[...COMMON_TIME_ZONES]}
        today={todayIn(profile.timeZone)}
        multiCurrency={isEnabled("ENABLE_MULTI_CURRENCY")}
      />
    </div>
  );
}
