"use client";

import Link from "next/link";
import { Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import type { GoalListItem } from "@/lib/goals/service";
import { GoalMenu, type GoalActions } from "./goal-actions";
import { GoalProgressBar } from "./goal-progress-bar";
import { deadlineText, GoalStatusBadge, PriorityBadge } from "./goal-status";
import { KindLegend } from "./kind";

/** A goal in the list: progress split into actual and planned, and what it takes to finish on time. */
export function GoalCard({ goal, actions }: { goal: GoalListItem; actions: GoalActions }) {
  const fmt = useFormat();
  const { progress, totals } = goal;
  const pct = Math.floor(progress.progressBps / 100);
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-start gap-3 px-5 pt-5">
        <CategoryIcon icon={goal.icon} color={goal.color} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">
            <Link href={`/goals/${goal.id}`} className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {goal.name}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{deadlineText(goal, (d) => fmt.date(d))}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <GoalStatusBadge goal={goal} />
            <PriorityBadge priority={goal.priority} />
          </div>
        </div>
        <GoalMenu goal={goal} actions={actions} triggerClassName="-mr-2 -mt-1.5" />
      </div>

      <div className="mt-4 px-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate">
            <span className="tabular text-xl font-semibold tracking-tight text-foreground">{fmt.money(progress.current)}</span>
            <span className="tabular text-[13px] text-muted-foreground"> of {fmt.money(progress.target)}</span>
          </p>
          <p className="tabular shrink-0 text-sm font-medium text-foreground">{pct}%</p>
        </div>
        <GoalProgressBar
          className="mt-2"
          actual={totals.actual}
          planned={totals.planned}
          target={progress.target}
          label={`${goal.name} progress`}
          valueText={`${pct}%: ${fmt.money(totals.actual)} actual and ${fmt.money(totals.planned)} planned of ${fmt.money(progress.target)}`}
        />
        <KindLegend className="mt-2" actual={totals.actual} planned={totals.planned} money={(c) => fmt.money(c)} />
      </div>

      <div className="mt-4 flex-1 border-t border-border px-5 py-3">
        <NextStep goal={goal} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-2.5">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {goal.linkedAccount ? (
            <span className="inline-flex items-center gap-1">
              <Landmark className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{goal.linkedAccount.name}</span>
            </span>
          ) : goal.lastContributionDate ? (
            `Last added ${lowerRelative(fmt.relative(goal.lastContributionDate))}`
          ) : (
            "Nothing added yet"
          )}
        </p>
        {goal.status !== "ARCHIVED" ? (
          <Button size="sm" variant="outline" className="-mr-1" onClick={() => actions.addMoney(goal)} aria-label={`Add money to ${goal.name}`}>
            <Plus /> Add money
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="-mr-1" onClick={() => actions.restore(goal)}>
            Restore
          </Button>
        )}
      </div>
    </Card>
  );
}

/** What it takes from here: per-period amounts for a deadline, or the pace-based estimate without one. */
function NextStep({ goal }: { goal: GoalListItem }) {
  const fmt = useFormat();
  const { progress, pace } = goal;
  if (goal.status === "ARCHIVED") return <p className="text-xs text-muted-foreground">Archived. Its history is kept; restore it to keep saving.</p>;
  if (goal.status === "COMPLETED" || progress.isComplete) {
    return <p className="text-xs text-muted-foreground">{progress.isComplete ? `Target reached — ${fmt.money(progress.current)} set aside.` : `Marked complete with ${fmt.money(progress.current)} set aside.`}</p>;
  }
  if (progress.isOverdue) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{fmt.money(progress.remaining)}</span> still to go. Pick a new deadline to get a fresh plan.
      </p>
    );
  }
  if (progress.requiredMonthly !== null) {
    return (
      <div>
        <p className="text-xs text-muted-foreground">To finish on time (estimate)</p>
        <dl className="mt-1.5 grid grid-cols-3 gap-2">
          {(
            [
              ["a week", progress.requiredWeekly],
              ["every 2 weeks", progress.requiredBiweekly],
              ["a month", progress.requiredMonthly],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col-reverse">
              <dt className="truncate text-xs text-muted-foreground">{label}</dt>
              <dd className="tabular truncate text-sm font-semibold text-foreground">{fmt.money(value ?? 0)}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (pace.currentMonthlyPace > 0 && pace.projectedCompletion && Number(pace.projectedCompletion.slice(0, 4)) - Number(fmt.today.slice(0, 4)) <= 10) {
    return (
      <p className="text-xs text-muted-foreground">
        No deadline. At your recent pace of <span className="tabular font-medium text-foreground">{fmt.money(pace.currentMonthlyPace)}</span> a month, you&apos;d get there around{" "}
        <span className="font-medium text-foreground">{fmt.date(pace.projectedCompletion, "monthYear")}</span> (estimate).
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">No deadline. Add one to see how much to set aside each week or payday.</p>;
}

/** "Today"/"Yesterday" read mid-sentence: "Last added today". */
function lowerRelative(text: string): string {
  return text === "Today" || text === "Yesterday" ? text.toLowerCase() : text;
}
