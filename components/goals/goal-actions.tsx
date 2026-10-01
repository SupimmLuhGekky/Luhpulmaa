"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CircleCheck, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteGoalAction, updateGoalAction } from "@/app/actions/goals";
import type { GoalAccountOption, GoalListItem } from "@/lib/goals/service";
import { ContributionDialog, type ContributionDialogProps } from "./contribution-dialog";
import { GoalDialog } from "./goal-dialog";

type Status = GoalListItem["status"];
export type ContributionKind = NonNullable<NonNullable<ContributionDialogProps["initial"]>["kind"]>;

/**
 * Edit, add money, archive/restore, complete/reopen and delete for goals, shared by
 * the goals list and the goal page. Render `dialogs` once; call the returned handlers.
 */
export function useGoalActions({ accounts, contributionKind, onDeleted }: { accounts: GoalAccountOption[]; contributionKind?: ContributionKind; onDeleted?: (goal: GoalListItem) => void }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<GoalListItem | null>(null);
  const [adding, setAdding] = React.useState<{ goal: GoalListItem; initial?: ContributionDialogProps["initial"] } | null>(null);
  const [deleting, setDeleting] = React.useState<GoalListItem | null>(null);

  const setStatus = React.useCallback(
    async (goal: GoalListItem, status: Status, opts: { undo?: Status } = {}) => {
      const res = await updateGoalAction({ id: goal.id, patch: { status } });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      const message = status === "ARCHIVED" ? "Goal archived" : status === "COMPLETED" ? "Goal marked as complete" : goal.status === "ARCHIVED" ? "Goal restored" : "Goal reopened";
      const undo = opts.undo;
      toast.success(message, { description: goal.name, action: undo ? { label: "Undo", onClick: () => void setStatus({ ...goal, status }, undo) } : undefined });
      router.refresh();
    },
    [router],
  );

  const actions = {
    edit: (goal: GoalListItem) => setEditing(goal),
    addMoney: (goal: GoalListItem, initial?: ContributionDialogProps["initial"]) => setAdding({ goal, initial }),
    remove: (goal: GoalListItem) => setDeleting(goal),
    archive: (goal: GoalListItem) => setStatus(goal, "ARCHIVED", { undo: goal.status }),
    restore: (goal: GoalListItem) => setStatus(goal, goal.progress.isComplete ? "COMPLETED" : "ACTIVE"),
    complete: (goal: GoalListItem) => setStatus(goal, "COMPLETED", { undo: goal.status }),
    reopen: (goal: GoalListItem) => setStatus(goal, "ACTIVE"),
  };

  const dialogs = (
    <>
      <GoalDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} goal={editing} accounts={accounts} onSaved={() => router.refresh()} />
      {adding ? (
        <ContributionDialog
          open
          onOpenChange={(o) => !o && setAdding(null)}
          goal={{ id: adding.goal.id, name: adding.goal.name, totals: adding.goal.totals, remaining: adding.goal.progress.remaining }}
          initial={{ kind: contributionKind, ...adding.initial }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "this goal"}?`}
        description={
          deleting?.contributionCount
            ? `Its ${deleting.contributionCount} contribution${deleting.contributionCount === 1 ? "" : "s"} will be deleted too, and this can't be undone. Archive it instead to keep the history. Money in your accounts isn't affected.`
            : "This can't be undone. Money in your accounts isn't affected."
        }
        confirmLabel="Delete goal"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const goal = deleting;
          const res = await deleteGoalAction({ id: goal.id });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success("Goal deleted", { description: goal.name });
          setDeleting(null);
          if (onDeleted) onDeleted(goal);
          else router.refresh();
        }}
      />
    </>
  );

  return { actions, dialogs };
}

export type GoalActions = ReturnType<typeof useGoalActions>["actions"];

/** The ⋯ menu for a goal. */
export function GoalMenu({ goal, actions, showAddMoney = true, triggerClassName }: { goal: GoalListItem; actions: GoalActions; showAddMoney?: boolean; triggerClassName?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${goal.name}`} className={triggerClassName}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {showAddMoney && goal.status !== "ARCHIVED" ? (
          <DropdownMenuItem onSelect={() => actions.addMoney(goal)}>
            <Plus /> Add money
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => actions.edit(goal)}>
          <Pencil /> Edit goal
        </DropdownMenuItem>
        {goal.status === "ACTIVE" ? (
          <DropdownMenuItem onSelect={() => actions.complete(goal)}>
            <CircleCheck /> Mark as complete
          </DropdownMenuItem>
        ) : null}
        {goal.status === "COMPLETED" ? (
          <DropdownMenuItem onSelect={() => actions.reopen(goal)}>
            <RotateCcw /> Reopen goal
          </DropdownMenuItem>
        ) : null}
        {goal.status === "ARCHIVED" ? (
          <DropdownMenuItem onSelect={() => actions.restore(goal)}>
            <ArchiveRestore /> Restore goal
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => actions.archive(goal)}>
            <Archive /> Archive goal
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => actions.remove(goal)}>
          <Trash2 /> Delete goal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
