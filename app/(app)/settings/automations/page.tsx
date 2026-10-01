import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, Eye, Repeat2, ShieldCheck } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { formatDateTime } from "@/lib/dates";
import { isEnabled } from "@/lib/flags";
import { listAutomations } from "@/lib/automation/service";
import { getProfile } from "@/lib/users/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { SettingRow, SettingRows, SettingsPageHeader, SettingsSection } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Automations · Settings" };

const FACTS = [
  { icon: Repeat2, title: "When they run", text: "As transactions are added or imported, on the schedule you pick, or when a subscription or budget alert happens." },
  { icon: ShieldCheck, title: "Plans, not transfers", text: "Money actions record planned allocations toward goals. Harbour never moves money between accounts." },
  { icon: CalendarClock, title: "Never twice", text: "Each automation acts on a transaction or a scheduled date only once, so a re-sync can't double a plan." },
  { icon: Eye, title: "Try before you save", text: "Preview any automation on the last 90 days of transactions before turning it on." },
];

export default async function AutomationSettingsPage() {
  const user = await requireOnboardedUser();
  const enabled = isEnabled("ENABLE_AUTOMATIONS");
  const [profile, automations] = await Promise.all([getProfile(user.id), enabled ? listAutomations(user.id) : Promise.resolve([])]);
  const active = automations.filter((a) => a.isActive).length;
  const runs = automations.reduce((sum, a) => sum + a.runCount, 0);
  const lastRun = automations.reduce<string | null>((latest, a) => (a.lastExecutedAt && (!latest || a.lastExecutedAt > latest) ? a.lastExecutedAt : latest), null);

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Automations"
        description="Rules that categorise and tag transactions, remind you of things and plan money for your goals."
        actions={
          enabled ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/automations">
                Open automations <ArrowRight />
              </Link>
            </Button>
          ) : null
        }
      />

      {enabled ? (
        <SettingsSection id="automation-status" title="Status" action={<Badge variant="positive">On for this server</Badge>}>
          <SettingRows>
            <SettingRow inline label="Your automations" description={automations.length ? `${active} of ${automations.length} turned on` : "You haven't created any yet."}>
              <Button asChild size="sm" variant={automations.length ? "ghost" : "primary"}>
                <Link href={automations.length ? "/automations" : "/automations/new"}>{automations.length ? "Manage" : "Create one"}</Link>
              </Button>
            </SettingRow>
            <SettingRow inline label="Runs so far" description={lastRun ? `Last run ${formatDateTime(lastRun, profile.timeZone, profile.locale)}` : "Nothing has run yet."}>
              <span className="text-sm font-medium tabular text-foreground">{runs.toLocaleString(profile.locale)}</span>
            </SettingRow>
          </SettingRows>
        </SettingsSection>
      ) : (
        <Notice tone="neutral" title="Automations are turned off on this server">
          No automation runs while they&apos;re off and the Automations page is hidden. Anything you set up earlier is kept and resumes when they&apos;re turned back on (the server&apos;s
          ENABLE_AUTOMATIONS setting).
        </Notice>
      )}

      <SettingsSection id="automation-facts" title="How automations work">
        <ul className="grid gap-4 sm:grid-cols-2">
          {FACTS.map((f) => (
            <li key={f.title} className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary" aria-hidden>
                <f.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{f.title}</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">{f.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </SettingsSection>
    </div>
  );
}
