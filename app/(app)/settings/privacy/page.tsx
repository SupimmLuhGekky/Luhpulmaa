import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Scale } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { addMonthKey, formatMonthKey, monthKey, todayIn } from "@/lib/dates";
import { isEnabled } from "@/lib/flags";
import { COMPLIANCE_NOTICE } from "@/lib/banking-core";
import { aiClient } from "@/lib/ai/client";
import { listConnections } from "@/lib/accounts/service";
import { getProfile } from "@/lib/users/service";
import { Notice } from "@/components/shared/notice";
import { ExportPanel } from "@/components/settings/export-panel";
import { AiOptInSwitch, DeleteAccountButton, DisconnectAllButton } from "@/components/settings/privacy-controls";
import { SettingRow, SettingRows, SettingsPageHeader, SettingsSection } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Data & privacy · Settings" };

const LEGAL_LINKS = [
  { href: "/legal#terms", label: "Terms of use" },
  { href: "/legal#privacy", label: "Privacy policy" },
  { href: "/legal#rights", label: "Your rights" },
  { href: "/legal#security", label: "Security" },
];

export default async function PrivacySettingsPage() {
  const user = await requireOnboardedUser();
  const [profile, connections] = await Promise.all([getProfile(user.id), listConnections(user.id)]);
  const today = todayIn(profile.timeZone);
  const thisMonth = monthKey(today);
  const months = Array.from({ length: 13 }, (_, i) => {
    const key = addMonthKey(thisMonth, -i);
    return { value: key, label: i === 0 ? `${formatMonthKey(key, profile.locale)} (this month)` : formatMonthKey(key, profile.locale) };
  });
  const activeConnections = connections.filter((c) => c.status !== "DISCONNECTED").length;

  const aiFeatures = [isEnabled("ENABLE_AI_ASSISTANT") && "the assistant", isEnabled("ENABLE_AI_CATEGORIZATION") && "category suggestions"].filter(Boolean) as string[];
  const aiConfigured = Boolean(aiClient());
  const aiAvailable = aiFeatures.length > 0 && aiConfigured;

  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Data & privacy" description="Your data is yours: take a copy any time, decide what optional features may read, or delete it all." />

      <SettingsSection id="export" title="Export your data" description="Spreadsheet-ready CSV files with only your data. Each export is listed in your security activity.">
        <ExportPanel today={today} locale={profile.locale} months={months} />
      </SettingsSection>

      <SettingsSection
        id="ai"
        title="AI features"
        description={
          aiAvailable
            ? "When you use one, the details it needs (such as amounts, dates, merchant and category names) are sent to Anthropic's Claude API to produce the answer. Your password, bank credentials and access tokens are never sent."
            : aiFeatures.length
              ? "AI features are switched on for this server but no AI provider is set up, so nothing can be sent."
              : "AI features are turned off on this server. Nothing is sent to an AI provider."
        }
      >
        <SettingRows>
          <AiOptInSwitch initial={profile.preferences.aiOptIn} available={aiAvailable} features={aiFeatures} />
        </SettingRows>
      </SettingsSection>

      <SettingsSection id="connected" title="Connected services" description="Bank connections let Harbour read balances and transactions. They can't move money.">
        <SettingRows>
          <SettingRow
            label={activeConnections ? `${activeConnections} active ${activeConnections === 1 ? "connection" : "connections"}` : "No active bank connections"}
            description="Disconnecting deletes the stored access and keeps your history."
          >
            <DisconnectAllButton count={activeConnections} />
          </SettingRow>
        </SettingRows>
      </SettingsSection>

      <SettingsSection id="legal" title="About Harbour">
        <div className="space-y-4">
          <Notice tone="neutral" title="Not a bank">
            {COMPLIANCE_NOTICE}
          </Notice>
          <ul className="grid gap-2 sm:grid-cols-2">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Scale className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">{l.label}</span>
                  <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </SettingsSection>

      <SettingsSection
        id="delete-account"
        tone="danger"
        title="Delete account"
        description="Permanently deletes your account and everything in it. You'll need your password."
        action={<DeleteAccountButton isDemo={profile.isDemo} />}
      >
        {profile.isDemo ? <p className="text-[13px] text-muted-foreground">The shared demo account can&apos;t be deleted. Sign up for your own account to try this.</p> : null}
      </SettingsSection>
    </div>
  );
}
