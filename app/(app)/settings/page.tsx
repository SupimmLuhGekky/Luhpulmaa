import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { isEnabled } from "@/lib/flags";
import { getProfile } from "@/lib/users/service";
import { Badge } from "@/components/ui/badge";
import { SettingsIndexList } from "@/components/settings/settings-shell";
import { SettingsPageHeader } from "@/components/settings/settings-ui";
import { initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireOnboardedUser();
  const profile = await getProfile(user.id);
  const memberSince = new Intl.DateTimeFormat(profile.locale, { month: "long", year: "numeric", timeZone: profile.timeZone }).format(new Date(profile.createdAt));
  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Settings" description="Your profile, preferences, connected services and data." />
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-soft">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-base font-semibold text-primary" aria-hidden>
          {initials(profile.firstName, profile.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-foreground">
            <span className="truncate">
              {profile.firstName} {profile.lastName}
            </span>
            {profile.isDemo ? <Badge variant="warning">Demo account</Badge> : null}
          </p>
          <p className="truncate text-[13px] text-muted-foreground">{profile.email}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Member since {memberSince}</p>
        </div>
      </div>
      <SettingsIndexList automationsEnabled={isEnabled("ENABLE_AUTOMATIONS")} />
    </div>
  );
}
