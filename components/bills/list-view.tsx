"use client";

import * as React from "react";
import { CalendarCheck } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/shared/empty-state";
import { useFormat } from "@/components/providers/format-provider";
import type { LocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useBillActions } from "./bill-actions";
import { longDay, relativeDay } from "./day-panel";
import { groupByDate } from "./month-view";
import { OccurrenceItem } from "./occurrence-item";
import type { Occurrence } from "./types";

type Show = "all" | "unpaid" | "paid";

/** Agenda of the month's bills, grouped by due date, filterable by paid state. */
export function ListView({ monthLabel, occurrences }: { monthLabel: string; occurrences: Occurrence[] }) {
  const fmt = useFormat();
  const { resolve } = useBillActions();
  const [show, setShow] = React.useState<Show>("all");
  const resolved = occurrences.map((o) => ({ o, paid: resolve(o).paid }));
  const counts = { all: resolved.length, unpaid: resolved.filter((r) => !r.paid).length, paid: resolved.filter((r) => r.paid).length };
  const visible = resolved.filter((r) => show === "all" || (show === "paid") === r.paid).map((r) => r.o);
  const groups = [...groupByDate(visible).entries()] as [LocalDate, Occurrence[]][];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 sm:px-5">
        <p className="text-xs text-muted-foreground">
          {counts.all} due date{counts.all === 1 ? "" : "s"} in {monthLabel}
        </p>
        <Segmented<Show>
          size="sm"
          value={show}
          onChange={setShow}
          aria-label="Show bills"
          options={[
            { value: "all", label: `All ${counts.all}` },
            { value: "unpaid", label: `Unpaid ${counts.unpaid}` },
            { value: "paid", label: `Paid ${counts.paid}` },
          ]}
        />
      </div>
      {groups.length ? (
        <ol>
          {groups.map(([d, items]) => {
            const rel = relativeDay(d, fmt.today);
            const total = items.reduce((sum, o) => sum + resolve(o).amountCents, 0);
            return (
              <li key={d} className="border-b border-border px-4 py-3 last:border-b-0 sm:px-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {longDay(d, fmt.locale)}
                    {rel ? <span className={cn("ml-2 text-xs font-medium", d === fmt.today ? "text-primary" : "text-muted-foreground")}>{rel}</span> : null}
                  </h3>
                  {items.length > 1 ? <span className="tabular shrink-0 text-xs text-muted-foreground">{fmt.money(total)}</span> : null}
                </div>
                <ul className="divide-y divide-border">
                  {items.map((o) => (
                    <OccurrenceItem key={`${o.billId}:${o.dueDate}`} occurrence={o} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          compact
          icon={CalendarCheck}
          title={show === "unpaid" && counts.all ? `Everything in ${monthLabel} is marked paid` : show === "paid" && counts.all ? `Nothing marked paid in ${monthLabel} yet` : `No bills due in ${monthLabel}`}
          description={show === "all" ? "Use the arrows to look at another month." : undefined}
        />
      )}
    </div>
  );
}
