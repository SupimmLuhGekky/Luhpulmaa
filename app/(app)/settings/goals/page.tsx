import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Workflow } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { isEnabled } from "@/lib/flags";
import { listAutomations } from "@/lib/automation/service";
import { listGoals } from "@/lib/goals/service";
import { listPreferences } from "@/lib/notifications/service";
import { channelAvailability } from "@/lib/notifications/channels";
import { userPreferences } from "@/lib/settings/preferences";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { GoalContributionKindForm } from "@/components/settings/goal-preferences-form";
import { SettingRow, SettingRows, SettingsPageHeader, SettingsSection } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Goals · Settings" };

const GOAL_ACTIONS = new Set(["ALLOCATE_TO_GOAL", "ROUND_UP_TO_GOAL"]);

function channelSummary(p: { inApp: boolean; email: boolean; push: boolean; sms: boolean }, available: { email: boolean; push: boolean; sms: boolean }) {
  const on = [p.inApp && "in the app", p.email && available.email && "by email", p.push && available.push && "as push", p.sms && available.sms && "by text"].filter(Boolean) as string[];
  if (!on.length) return "Off";
  const text = on.length === 1 ? on[0] : `${on.slice(0, -1).join(", ")} and ${on.at(-1)}`;
  return text[0].toUpperCase() + text.slice(1);
}

export default async function GoalSettingsPage() {
  const user = await requireOnboardedUser();
  const automationsEnabled = isEnabled("ENABLE_AUTOMATIONS");
  const [prefs, goals, automations, notificationPrefs] = await Promise.all([
    userPreferences(user.id),
    listGoals(user.id),
    automationsEnabled ? listAutomations(user.id) : Promise.resolve([]),
    listPreferences(user.id),
  ]);
  const goalAutomations = automations.filter((a) => a.actions.some((x) => GOAL_ACTIONS.has(x.type)));
  const activeGoalAutomations = goalAutomations.filter((a) => a.isActive).length;
  const activeGoals = goals.filter((g) => g.status === "ACTIVE").length;
  const availability = channelAvailability();
  const available = { email: availability.email.available, push: availability.push.available, sms: availability.sms.available };
  const reminders = notificationPrefs.filter((p) => p.type === "GOAL_PROGRESS" || p.type === "GOAL_DEADLINE");

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Goals"
        description={
          <>
            How money you put toward goals is recorded. You have {activeGoals} active {activeGoals === 1 ? "goal" : "goals"}:{" "}
            <Link href="/goals" className="font-medium text-primary underline-offset-4 hover:underline">
              manage them in Goals
            </Link>
            .
          </>
        }
      />

      <SettingsSection id="contribution-kind" title="When you add money to a goal" description="The option that's picked by default. You can still choose the other one each time.">
        <div className="space-y-3">
          <GoalContributionKindForm initial={prefs.goalContributionKind} />
          <Notice tone="neutral" title="Harbour never moves money">
            A planned allocation counts toward your goal in Harbour, but the money stays in your account. To set it aside for real, make the transfer at your bank, then record it as
            “Money I moved myself”.
          </Notice>
        </div>
      </SettingsSection>

      <SettingsSection
        id="goal-automations"
        title="Automatic contributions"
        description="Automations can plan money for a goal when your pay arrives, on a schedule, or by rounding up purchases. They only plan: nothing is transferred."
        action={
          automationsEnabled ? (
            <Button asChild variant="outline" size="sm">
              <Link href={goalAutomations.length ? "/automations" : "/automations/new?template=payday-goal"}>
                <Workflow /> {goalAutomations.length ? "Manage automations" : "Set one up"}
              </Link>
            </Button>
          ) : null
        }
      >
        {automationsEnabled ? (
          <p className="text-sm text-foreground">
            {goalAutomations.length === 0
              ? "No automations plan money for your goals yet."
              : `${goalAutomations.length} ${goalAutomations.length === 1 ? "automation plans" : "automations plan"} money for your goals (${activeGoalAutomations} active).`}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Automations are turned off on this server.</p>
        )}
      </SettingsSection>

      <SettingsSection
        id="goal-reminders"
        title="Goal reminders"
        description="Notifications about your goals."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings/notifications">
              Change <ArrowRight />
            </Link>
          </Button>
        }
      >
        <SettingRows>
          {reminders.map((r) => (
            <SettingRow key={r.type} label={r.label} description={r.description} inline>
              <span className="text-[13px] text-muted-foreground">{channelSummary(r, available)}</span>
            </SettingRow>
          ))}
        </SettingRows>
      </SettingsSection>
    </div>
  );
}
