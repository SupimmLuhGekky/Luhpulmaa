"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { History, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { useFormat } from "@/components/providers/format-provider";
import { deleteContributionAction } from "@/app/actions/goals";
import { isActualKind } from "@/lib/goals/contributions";
import type { GoalContributionItem } from "@/lib/goals/service";
import { cn } from "@/lib/utils";
import { KindSwatch } from "./kind";

type Filter = "ALL" | "ACTUAL" | "PLANNED";
const PAGE = 20;
const GRID = "md:grid md:grid-cols-[7rem_minmax(0,1fr)_7.5rem_7.5rem_2.25rem] md:items-center md:gap-4";

function sourceLabel(c: GoalContributionItem): string {
  switch (c.source) {
    case "AUTOMATION":
      return c.automation ? `Automation · ${c.automation.name}` : "Automation";
    case "ROUND_UP":
      return "Round-up";
    case "ALLOCATION_PLAN":
      return "Paycheque plan";
    case "ONBOARDING":
      return "Set up during onboarding";
    default:
      return c.amount < 0 ? "Taken out by you" : "Added by you";
  }
}

/** Every contribution, newest first, filterable by kind; planned and actual never share a label or colour. */
export function ContributionHistory({ goalId, goalName, contributions }: { goalId: string; goalName: string; contributions: GoalContributionItem[] }) {
  const router = useRouter();
  const fmt = useFormat();
  const [filter, setFilter] = React.useState<Filter>("ALL");
  const [limit, setLimit] = React.useState(PAGE);
  const [deleting, setDeleting] = React.useState<GoalContributionItem | null>(null);

  const newestFirst = React.useMemo(() => [...contributions].reverse(), [contributions]);
  const counts = { ALL: newestFirst.length, ACTUAL: newestFirst.filter((c) => isActualKind(c.kind)).length, PLANNED: newestFirst.filter((c) => !isActualKind(c.kind)).length };
  const filtered = newestFirst.filter((c) => filter === "ALL" || (filter === "ACTUAL") === isActualKind(c.kind));
  const shown = filtered.slice(0, limit);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 sm:px-5">
        <Segmented
          size="sm"
          aria-label="Show contributions"
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setLimit(PAGE);
          }}
          options={[
            { value: "ALL", label: `All (${counts.ALL})` },
            { value: "ACTUAL", label: `Actual (${counts.ACTUAL})` },
            { value: "PLANNED", label: `Planned (${counts.PLANNED})` },
          ]}
        />
      </div>
      {!shown.length ? (
        <EmptyState
          compact
          icon={History}
          title={filter === "ALL" ? "Nothing added yet" : filter === "ACTUAL" ? "No actual transfers" : "No planned money"}
          description={filter === "ALL" ? "Money you add or earmark for this goal shows up here." : filter === "ACTUAL" ? "Record money you've moved yourself with Add money → Actual." : "Earmarks from you, a paycheque plan or an automation show up here."}
        />
      ) : (
        <>
          <div aria-hidden className={cn("hidden border-y border-border bg-subtle px-5 py-2 text-xs font-medium text-muted-foreground", GRID)}>
            <span>Date</span>
            <span>Details</span>
            <span>Kind</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          <ul className="divide-y divide-border border-t border-border md:border-t-0">
            {shown.map((c) => {
              const actual = isActualKind(c.kind);
              return (
                <li key={c.id} className={cn("flex items-start gap-3 px-4 py-3 sm:px-5", GRID)}>
                  <p className="hidden text-sm text-foreground md:block">{fmt.date(c.date)}</p>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-words text-sm text-foreground md:truncate">{sourceLabel(c)}</p>
                    <p className="line-clamp-2 break-words text-xs text-muted-foreground md:truncate">
                      <span className="md:hidden">{fmt.date(c.date)}</span>
                      {c.note ? (
                        <>
                          <span className="md:hidden"> · </span>
                          {c.note}
                        </>
                      ) : null}
                      {c.transactionId ? <span>{c.note ? " · " : ""}Linked to a bank transaction</span> : null}
                    </p>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground md:hidden">
                      <KindSwatch kind={actual ? "actual" : "planned"} /> {actual ? "Actual transfer" : "Planned"}
                    </p>
                  </div>
                  <p className="hidden items-center gap-1.5 text-[13px] text-muted-foreground md:inline-flex">
                    <KindSwatch kind={actual ? "actual" : "planned"} /> {actual ? "Actual transfer" : "Planned"}
                  </p>
                  <p className="tabular shrink-0 text-right text-sm font-medium text-foreground">
                    {c.amount < 0 ? "−" : "+"}
                    {fmt.money(Math.abs(c.amount))}
                    {c.amount < 0 ? <span className="block text-xs font-normal text-muted-foreground">taken out</span> : null}
                  </p>
                  <Button variant="ghost" size="icon-sm" className="-my-1 -mr-2 shrink-0 text-muted-foreground" aria-label={`Delete ${fmt.money(c.amount)} from ${fmt.date(c.date)}`} onClick={() => setDeleting(c)}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
          {filtered.length > shown.length ? (
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
              <p className="text-xs text-muted-foreground">
                Showing {shown.length} of {filtered.length}
              </p>
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                Show {Math.min(PAGE, filtered.length - shown.length)} more
              </Button>
            </div>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this entry?"
        description={
          deleting
            ? `${deleting.amount < 0 ? "Taking out " : ""}${fmt.money(Math.abs(deleting.amount))} ${isActualKind(deleting.kind) ? "actual" : "planned"} on ${fmt.date(deleting.date)}. ${goalName}'s total goes ${deleting.amount < 0 ? "up" : "down"} by that amount. Nothing changes in your accounts.`
            : undefined
        }
        confirmLabel="Delete entry"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteContributionAction({ id: deleting.id, goalId });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success("Entry deleted", { description: `${fmt.money(Math.abs(deleting.amount))} · ${fmt.date(deleting.date)}` });
          setDeleting(null);
          router.refresh();
        }}
      />
    </div>
  );
}
