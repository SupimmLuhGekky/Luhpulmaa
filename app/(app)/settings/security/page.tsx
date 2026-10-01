import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listSessions } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { coarseIp, describeUserAgent } from "@/lib/users/devices";
import { getProfile, listSecurityActivity } from "@/lib/users/service";
import { PasswordForm } from "@/components/settings/password-form";
import { SecurityActivity } from "@/components/settings/security-activity";
import { SessionsList, type SessionRow } from "@/components/settings/sessions-list";
import { SettingsPageHeader } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Security · Settings" };

export default async function SecuritySettingsPage() {
  const user = await requireOnboardedUser();
  const [profile, sessions, events] = await Promise.all([getProfile(user.id), listSessions(user.id), listSecurityActivity(user.id, 15)]);
  const when = (d: Date | string) => formatDateTime(d, profile.timeZone, profile.locale);
  const rows: SessionRow[] = sessions
    .map((s) => {
      const device = describeUserAgent(s.userAgent);
      return {
        id: s.id,
        device: device.label,
        kind: device.kind,
        network: coarseIp(s.ipAddress),
        createdAt: s.createdAt.toISOString(),
        createdLabel: when(s.createdAt),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s.id === user.sessionId,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));
  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Security" description="Keep your account safe: your password, the devices you're signed in on, and recent activity." />
      <PasswordForm isDemo={profile.isDemo} passwordChangedAt={profile.passwordChangedAt ? when(profile.passwordChangedAt) : null} />
      <SessionsList sessions={rows} />
      <SecurityActivity events={events.map((e) => ({ id: e.id, action: e.action, when: when(e.createdAt), device: e.device, network: e.network, detail: e.detail }))} />
    </div>
  );
}
