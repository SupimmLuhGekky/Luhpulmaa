"use client";

import type { Frequency } from "@prisma/client";
import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import { daysBetween } from "@/lib/dates";
import { FREQUENCY_LABELS } from "@/lib/dates/schedule";
import { cn } from "@/lib/utils";
import { useBillActions } from "./bill-actions";
import { BillMenu } from "./bill-menu";
import { StatusBadge } from "./status";
import type { Occurrence } from "./types";

/** Amount of one occurrence; estimates (variable bills not yet paid) get "≈". */
export function OccurrenceAmount({ occurrence, className }: { occurrence: Occurrence; className?: string }) {
  const fmt = useFormat();
  const estimate = occurrence.isVariableAmount && !occurrence.paid;
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {estimate ? (
        <>
          <span aria-hidden>≈ </span>
          <span className="sr-only">About </span>
        </>
      ) : null}
      {fmt.money(occurrence.amountCents)}
    </span>
  );
}

const LAYOUTS = {
  /** Actions beside the amount from `sm` up. */
  row: { grid: "grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]", actions: "sm:col-span-1 sm:col-start-auto sm:justify-end", clamp: "truncate" },
  /** Narrow containers: actions always on their own line. */
  stack: { grid: "grid-cols-[auto_minmax(0,1fr)_auto]", actions: "", clamp: "line-clamp-2" },
  /** The month view's day panel: a row below `lg`, stacked in the `lg` side column. */
  panel: {
    grid: "grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] lg:grid-cols-[auto_minmax(0,1fr)_auto]",
    actions: "sm:col-span-1 sm:col-start-auto sm:justify-end lg:col-span-2 lg:col-start-2 lg:justify-between",
    clamp: "truncate lg:line-clamp-2 lg:whitespace-normal",
  },
} as const;

/** One bill on one due date, with its status and the paid/unpaid action. */
export function OccurrenceItem({ occurrence, layout = "row", showDate = false }: { occurrence: Occurrence; layout?: keyof typeof LAYOUTS; showDate?: boolean }) {
  const fmt = useFormat();
  const actions = useBillActions();
  const o = actions.resolve(occurrence);
  const status = actions.statusOf(occurrence);
  const pending = actions.isPending(occurrence);
  const late = status === "overdue" ? daysBetween(o.dueDate, fmt.today) : 0;
  const meta = [
    showDate ? `Due ${fmt.date(o.dueDate, "monthDay")}` : null,
    late ? `${late} day${late === 1 ? "" : "s"} late` : null,
    FREQUENCY_LABELS[o.frequency as Frequency] ?? null,
    o.autopay ? "Autopay" : null,
    o.account?.name ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  const context = <span className="sr-only">: {o.name}, due {fmt.date(o.dueDate, "long")}</span>;
  const l = LAYOUTS[layout];

  return (
    <li className={cn("grid items-center gap-x-3 gap-y-2 py-3", l.grid)}>
      <CategoryIcon icon={o.category?.icon ?? "receipt"} color={o.category?.color ?? "#64748b"} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{o.name}</p>
        {meta ? <p className={cn("text-xs text-muted-foreground", l.clamp)}>{meta}</p> : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <OccurrenceAmount occurrence={o} className="text-sm font-semibold text-foreground" />
        <StatusBadge status={status} />
      </div>
      <div className={cn("col-span-2 col-start-2 flex items-center justify-between gap-1", l.actions)}>
        {o.paid ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => actions.markUnpaid(occurrence)} disabled={pending}>
            <RotateCcw /> Mark unpaid
            {context}
          </Button>
        ) : (
          <Button variant={status === "upcoming" ? "outline" : "primary"} size="sm" onClick={() => actions.markPaid(occurrence)} loading={pending}>
            {pending ? null : <Check />} Mark paid
            {context}
          </Button>
        )}
        <BillMenu billId={o.billId} name={o.name} />
      </div>
    </li>
  );
}
