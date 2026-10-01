"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { useFormat } from "@/components/providers/format-provider";
import type { GoalAccountOption, GoalListItem } from "@/lib/goals/service";
import { GoalCard } from "./goal-card";
import { GoalDialog } from "./goal-dialog";
import { useGoalActions, type ContributionKind } from "./goal-actions";
import { KIND_EXPLANATION, KindSwatch } from "./kind";

type Filter = GoalListItem["status"];

export interface GoalsScreenProps {
  goals: GoalListItem[];
  accounts: GoalAccountOption[];
  /** How "Add money" records a contribution unless the person picks otherwise (their setting). */
  contributionKind?: ContributionKind;
  /** /goals?new=1 (header "New → Goal") opens the create dialog. */
  openNew: boolean;
}

export function GoalsScreen({ goals, accounts, contributionKind, openNew }: GoalsScreenProps) {
  const router = useRouter();
  const fmt = useFormat();
  const [filter, setFilter] = React.useState<Filter>("ACTIVE");
  const [createOpen, setCreateOpen] = React.useState(openNew);
  const { actions, dialogs } = useGoalActions({ accounts, contributionKind });

  React.useEffect(() => {
    if (openNew) setCreateOpen(true);
  }, [openNew]);

  // Closing drops ?new=1 so Back doesn't reopen the dialog (and the reload shows a new goal).
  const closeCreate = (open: boolean) => {
    setCreateOpen(open);
    if (!open && openNew) router.replace("/goals", { scroll: false });
  };

  const counts = { ACTIVE: 0, COMPLETED: 0, ARCHIVED: 0 };
  for (const g of goals) counts[g.status]++;
  const shown = goals.filter((g) => g.status === filter);
  const active = goals.filter((g) => g.status === "ACTIVE");
  const sum = (f: (g: GoalListItem) => number) => active.reduce((a, g) => a + f(g), 0);
  const actual = sum((g) => g.totals.actual);
  const planned = sum((g) => g.totals.planned);
  const toGo = sum((g) => g.progress.remaining);
  const withDeadline = active.filter((g) => g.progress.requiredMonthly !== null && !g.progress.isOverdue);
  const neededMonthly = withDeadline.reduce((a, g) => a + (g.progress.requiredMonthly ?? 0), 0);

  const newButton = (
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      <Plus /> New goal
    </Button>
  );

  return (
    <>
      <PageHeader title="Goals" description="Save for what matters, at your own pace." actions={goals.length ? newButton : undefined} />

      {!goals.length ? (
        <Card>
          <EmptyState
            icon={Target}
            title="Start your first goal"
            description="An emergency fund, a trip, a new laptop — name it, set a target and Harbour shows what to set aside each payday."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> New goal
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Card className="p-4 sm:p-5">
              <Stat
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <KindSwatch kind="actual" /> Actual
                  </span>
                }
                value={fmt.money(actual)}
                hint="Money you moved yourself"
              />
            </Card>
            <Card className="p-4 sm:p-5">
              <Stat
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <KindSwatch kind="planned" /> Planned
                  </span>
                }
                value={fmt.money(planned)}
                hint="Earmarked, not moved"
              />
            </Card>
            <Card className="p-4 sm:p-5">
              <Stat label="Still to go" value={fmt.money(toGo)} hint={`Across ${active.length} active goal${active.length === 1 ? "" : "s"}`} />
            </Card>
            <Card className="p-4 sm:p-5">
              <Stat
                label="Needed per month"
                value={withDeadline.length ? fmt.money(neededMonthly) : "—"}
                hint={withDeadline.length ? `To meet ${withDeadline.length === 1 ? "your deadline" : `${withDeadline.length} deadlines`} (estimate)` : "Add deadlines to see this"}
              />
            </Card>
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {KIND_EXPLANATION}
          </p>

          <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              size="sm"
              aria-label="Show goals"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "ACTIVE", label: `Active (${counts.ACTIVE})` },
                { value: "COMPLETED", label: `Completed (${counts.COMPLETED})` },
                { value: "ARCHIVED", label: `Archived (${counts.ARCHIVED})` },
              ]}
            />
          </div>

          {shown.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((g) => (
                <GoalCard key={g.id} goal={g} actions={actions} />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState
                compact
                icon={Target}
                title={filter === "ACTIVE" ? "No active goals" : filter === "COMPLETED" ? "No completed goals yet" : "No archived goals"}
                description={
                  filter === "ACTIVE"
                    ? "Start a new goal, or restore one you archived."
                    : filter === "COMPLETED"
                      ? "Goals move here once they reach their target or you mark them complete."
                      : "Archive a goal to put it away without losing its history."
                }
                action={filter === "ACTIVE" ? newButton : undefined}
              />
            </Card>
          )}
        </>
      )}

      <GoalDialog
        open={createOpen}
        onOpenChange={closeCreate}
        accounts={accounts}
        onSaved={() => {
          if (!openNew) router.refresh();
        }}
      />
      {dialogs}
    </>
  );
}
