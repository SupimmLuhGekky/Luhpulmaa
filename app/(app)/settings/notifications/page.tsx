import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { isEnabled } from "@/lib/flags";
import { channelAvailability } from "@/lib/notifications/channels";
import { listPreferences } from "@/lib/notifications/service";
import { userPreferences } from "@/lib/settings/preferences";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { AlertPreferencesForm } from "@/components/settings/alert-preferences-form";
import { NotificationPreferencesMatrix, type ChannelInfo } from "@/components/settings/notification-preferences";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Notifications · Settings" };

export default async function NotificationSettingsPage() {
  const user = await requireOnboardedUser();
  const [items, prefs] = await Promise.all([listPreferences(user.id), userPreferences(user.id)]);
  const availability = channelAvailability();
  const channels: ChannelInfo[] = [
    { key: "inApp", label: "In app", ...availability.inApp },
    { key: "email", label: "Email", ...availability.email },
    { key: "push", label: "Push", ...availability.push },
    { key: "sms", label: "Text messages", ...availability.sms },
  ];
  const enabled = isEnabled("ENABLE_NOTIFICATIONS");

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Notifications"
        description="Choose what Harbour tells you about, and where."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/notifications">
              Open notifications <ArrowRight />
            </Link>
          </Button>
        }
      />
      {!enabled ? (
        <Notice tone="warning" title="Notifications are paused on this server">
          Your choices are saved and will apply when notifications are turned back on.
        </Notice>
      ) : null}
      <SettingsSection id="notification-channels" title="Where you hear about things" description="Changes save as soon as you flip a switch.">
        <NotificationPreferencesMatrix items={items} channels={channels} />
      </SettingsSection>
      <AlertPreferencesForm initial={{ largeTransactionCents: prefs.largeTransactionCents, billReminderDays: prefs.billReminderDays }} budgetThresholds={prefs.budgetAlertThresholds} />
    </div>
  );
}
