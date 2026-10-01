import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { userPreferences } from "@/lib/settings/preferences";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Appearance · Settings" };

export default async function AppearanceSettingsPage() {
  const user = await requireOnboardedUser();
  const prefs = await userPreferences(user.id);
  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Appearance" description="How Harbour looks on this device." />
      <SettingsSection id="theme" title="Theme">
        <AppearanceForm saved={prefs.theme} />
      </SettingsSection>
      <p className="px-1 text-xs text-muted-foreground">
        Looking for date and number formats? They&apos;re in{" "}
        <Link href="/settings/region" className="font-medium text-primary underline-offset-4 hover:underline">
          Currency &amp; region
        </Link>
        .
      </p>
    </div>
  );
}
