"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, Info, Landmark, Minus, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import type { GoalAccountOption, GoalDetail } from "@/lib/goals/service";
import { ContributionHistory } from "./contribution-history";
import { GoalMenu, useGoalActions } from "./goal-actions";
import { GoalGrowthChart } from "./goal-growth-chart";
import { GoalProgressBar } from "./goal-progress-bar";
import { deadlineText, GoalStatusBadge, humanDuration, PriorityBadge } from "./goal-status";
import { KIND_EXPLANATION, KindLegend } from "./kind";

export function GoalDetailScreen({ goal, accounts }: { goal: GoalDetail; accounts: GoalAccountOption[] }) {
  const router = useRouter();
  const fmt = useFormat();
  const { actions, dialogs } = useGoalActions({ accounts, onDeleted: () => router.push("/goals") });
  const { progress, totals, pace } = goal;
  const pct = Math.floor(progress.progressBps / 100);
  const open = goal.status === "ACTIVE";
  // Money can be backdated (imports, round-ups), so the goal "started" with its first entry if that's earlier.
  const firstEntry = goal.contributions[0]?.date;
  const started = firstEntry && firstEntry < goal.createdOn ? firstEntry : goal.createdOn;
  const projected = pace.projectedCompletion;
  const projectedText = projected ? (Number(projected.slice(0, 4)) - Number(goal.today.slice(0, 4)) > 10 ? "More than 10 years (estimate)" : `${fmt.date(projected, "monthYear")} (estimate)`) : null;

  return (
    <>
      <Link href="/goals" className="mb-3 inline-flex items-center gap-1 rounded text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <ArrowLeft className="size-3.5" aria-hidden /> Goals
      </Link>

      <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <CategoryIcon icon={goal.icon} color={goal.color} size="lg" className="mt-0.5" />
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{goal.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{deadlineText(goal, (d) => fmt.date(d))}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <GoalStatusBadge goal={goal} />
              <PriorityBadge priority={goal.priority} />
              {goal.linkedAccount ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Landmark className="size-3" aria-hidden /> Kept in {goal.linkedAccount.name}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {goal.status !== "ARCHIVED" ? (
            <Button size="sm" onClick={() => actions.addMoney(goal)}>
              <Plus /> Add money
            </Button>
          ) : (
            <Button size="sm" onClick={() => actions.restore(goal)}>
              Restore goal
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => actions.edit(goal)}>
            <Pencil /> Edit
          </Button>
          <GoalMenu goal={goal} actions={actions} showAddMoney={false} />
        </div>
      </div>
      {goal.description ? <p className="-mt-2 mb-5 max-w-prose whitespace-pre-line text-sm text-muted-foreground">{goal.description}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <p className="text-[13px] font-medium text-muted-foreground">Set aside so far</p>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="min-w-0">
              <span className="tabular text-3xl font-semibold tracking-tight text-foreground">{fmt.money(progress.current)}</span>
              <span className="tabular text-sm text-muted-foreground"> of {fmt.money(progress.target)}</span>
            </p>
            <p className="tabular text-sm font-medium text-foreground">
              {pct}% · {progress.remaining > 0 ? `${fmt.money(progress.remaining)} to go` : "target reached"}
            </p>
          </div>
          <GoalProgressBar
            className="mt-3"
            size="lg"
            actual={totals.actual}
            planned={totals.planned}
            target={progress.target}
            label={`${goal.name} progress`}
            valueText={`${pct}%: ${fmt.money(totals.actual)} actual and ${fmt.money(totals.planned)} planned of ${fmt.money(progress.target)}`}
          />
          <KindLegend className="mt-3" size="md" actual={totals.actual} planned={totals.planned} money={(c) => fmt.money(c)} />
          <p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {KIND_EXPLANATION}
          </p>
          {goal.status !== "ARCHIVED" && (totals.planned > 0 || totals.actual > 0) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" className="-ml-2" onClick={() => actions.addMoney(goal, { direction: "WITHDRAW" })}>
                <Minus /> Take money out
              </Button>
            </div>
          ) : null}
        </Card>

        <Card className="p-5">
          <PlanPanel goal={goal} onEdit={() => actions.edit(goal)} />
          <dl className="mt-4 space-y-2 border-t border-border pt-4 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Recent pace</dt>
              <dd className="tabular text-right font-medium text-foreground">{pace.currentMonthlyPace > 0 ? `${fmt.money(pace.currentMonthlyPace)}/month` : "Nothing in 90 days"}</dd>
            </div>
            {open && !progress.isComplete && projectedText ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">At this pace</dt>
                <dd className="text-right font-medium text-foreground">{projectedText}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Started</dt>
              <dd className="text-right text-foreground">{fmt.date(started)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Pace counts actual and planned money from the last 90 days.</p>
        </Card>
      </div>

      <Card className="mt-4 min-w-0">
        <CardHeading title="Growth" description="How the amount set aside has built up. Steps are the days money was added or taken out." />
        <div className="px-4 pb-5 sm:px-5">
          {goal.growth.length >= 2 && goal.contributionCount > 0 ? (
            <GoalGrowthChart growth={goal.growth} target={progress.target} deadline={goal.deadline} today={goal.today} showPath={open} />
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">The chart starts once you add money to this goal.</p>
          )}
        </div>
      </Card>

      <Card className="mt-4 min-w-0">
        <CardHeading title="History" description="Every amount added or taken out, newest first." />
        <ContributionHistory goalId={goal.id} goalName={goal.name} contributions={goal.contributions} />
      </Card>

      {dialogs}
    </>
  );
}

/** What it takes from here: per-period amounts to meet the deadline (estimates), or a prompt to set one. */
function PlanPanel({ goal, onEdit }: { goal: GoalDetail; onEdit: () => void }) {
  const fmt = useFormat();
  const { progress, pace } = goal;
  if (goal.status === "ARCHIVED") {
    return (
      <>
        <p className="text-[13px] font-medium text-muted-foreground">Plan</p>
        <p className="mt-2 text-sm text-foreground">This goal is archived. Its history is kept; restore it to keep saving.</p>
      </>
    );
  }
  if (goal.status === "COMPLETED" || progress.isComplete) {
    return (
      <>
        <p className="text-[13px] font-medium text-muted-foreground">Plan</p>
        <p className="mt-2 text-sm text-foreground">
          {progress.isComplete ? `You reached ${fmt.money(progress.target)}${goal.completedOn ? ` on ${fmt.date(goal.completedOn)}` : ""}.` : `Marked complete with ${fmt.money(progress.current)} set aside.`}
        </p>
      </>
    );
  }
  if (!goal.deadline || progress.requiredMonthly === null) {
    return (
      <>
        <p className="text-[13px] font-medium text-muted-foreground">Plan</p>
        <p className="mt-2 text-sm text-foreground">No deadline yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">Add one to see how much to set aside each week, payday or month.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onEdit}>
          <CalendarClock /> Add a deadline
        </Button>
      </>
    );
  }
  if (progress.isOverdue) {
    return (
      <>
        <p className="text-[13px] font-medium text-muted-foreground">Plan</p>
        <p className="mt-2 text-sm text-foreground">
          The deadline passed on {fmt.date(goal.deadline)} with {fmt.money(progress.remaining)} still to go.
        </p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onEdit}>
          <CalendarClock /> Pick a new deadline
        </Button>
      </>
    );
  }
  const days = progress.daysLeft ?? 0;
  return (
    <>
      <p className="text-[13px] font-medium text-muted-foreground">
        To finish by {fmt.date(goal.deadline)} <span className="font-normal">({humanDuration(days)} left)</span>
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {(
          [
            ["a week", progress.requiredWeekly],
            ["every 2 weeks", progress.requiredBiweekly],
            ["a month", progress.requiredMonthly],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col-reverse">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="tabular truncate text-base font-semibold text-foreground">{fmt.money(value ?? 0)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Estimates.{" "}
        {pace.onTrack === true
          ? "Your recent pace is enough to finish on time."
          : pace.difference !== null && pace.difference > 0
            ? `About ${fmt.money(pace.difference)} a month more than your recent pace.`
            : ""}
      </p>
    </>
  );
}
