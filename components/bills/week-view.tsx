"use client";

import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/components/providers/format-provider";
import { weekDates } from "@/lib/bills/calendar";
import type { LocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useBillActions } from "./bill-actions";
import { BillMenu } from "./bill-menu";
import { longDay, relativeDay } from "./day-panel";
import { groupByDate } from "./month-view";
import { OccurrenceAmount, OccurrenceItem } from "./occurrence-item";
import { StatusBadge } from "./status";
import type { Occurrence } from "./types";

function utc(d: LocalDate) {
  return new Date(`${d}T00:00:00Z`);
}

/** Compact card for the seven-column week board. */
function WeekCard({ occurrence }: { occurrence: Occurrence }) {
  const fmt = useFormat();
  const actions = useBillActions();
  const o = actions.resolve(occurrence);
  const status = actions.statusOf(occurrence);
  const pending = actions.isPending(occurrence);
  const context = <span className="sr-only">: {o.name}, due {fmt.date(o.dueDate, "long")}</span>;
  return (
    <li className={cn("rounded-lg border border-border bg-card p-2 shadow-soft", status === "overdue" && "border-danger/40")}>
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 truncate text-[13px] font-medium text-foreground" title={o.name}>
          {o.name}
        </p>
        <BillMenu billId={o.billId} name={o.name} className="-mr-1 -mt-1 size-7 shrink-0" />
      </div>
      <OccurrenceAmount occurrence={o} className="block text-sm font-semibold text-foreground" />
      <StatusBadge status={status} className="mt-1" />
      {o.paid ? (
        <Button variant="ghost" size="sm" className="mt-2 h-7 w-full px-2 text-xs text-muted-foreground" onClick={() => actions.markUnpaid(occurrence)} disabled={pending}>
          <RotateCcw /> Unpaid
          {context}
        </Button>
      ) : (
        <Button variant={status === "upcoming" ? "outline" : "primary"} size="sm" className="mt-2 h-7 w-full px-2 text-xs" onClick={() => actions.markPaid(occurrence)} loading={pending}>
          {pending ? null : <Check />} Mark paid
          {context}
        </Button>
      )}
    </li>
  );
}

/** One week: a seven-column board from `lg` up, a day-by-day list below. */
export function WeekView({ date, weekStartsOn, occurrences }: { date: LocalDate; weekStartsOn: number; occurrences: Occurrence[] }) {
  const fmt = useFormat();
  const { resolve } = useBillActions();
  const days = weekDates(date, weekStartsOn);
  const byDate = groupByDate(occurrences);
  const short = new Intl.DateTimeFormat(fmt.locale, { weekday: "short", timeZone: "UTC" });

  return (
    <>
      <ol className="hidden grid-cols-7 gap-2 p-3 lg:grid" aria-label="Bills this week by day">
        {days.map((d) => {
          const items = byDate.get(d) ?? [];
          const isToday = d === fmt.today;
          const total = items.reduce((sum, o) => sum + resolve(o).amountCents, 0);
          return (
            <li key={d} className={cn("flex min-h-56 min-w-0 flex-col rounded-lg bg-subtle p-1.5", isToday && "ring-1 ring-primary/50")} aria-label={`${longDay(d, fmt.locale)}${isToday ? ", today" : ""}: ${items.length ? `${items.length} bill${items.length === 1 ? "" : "s"}` : "no bills"}`}>
              <div className="flex items-center justify-between gap-1 px-1 pb-2 pt-0.5" aria-hidden>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{short.format(utc(d))}</span>
                <span className={cn("tabular flex size-6 items-center justify-center rounded-full text-xs", isToday ? "bg-primary font-semibold text-primary-foreground" : "text-foreground")}>{Number(d.slice(8, 10))}</span>
              </div>
              {items.length ? (
                <ul className="flex flex-col gap-1.5">
                  {items.map((o) => (
                    <WeekCard key={`${o.billId}:${o.dueDate}`} occurrence={o} />
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-xs text-muted-foreground">No bills</p>
              )}
              {items.length > 1 ? <p className="tabular mt-auto px-1 pt-2 text-right text-[11px] text-muted-foreground">{fmt.money(total)}</p> : null}
            </li>
          );
        })}
      </ol>

      <ol className="divide-y divide-border lg:hidden" aria-label="Bills this week by day">
        {days.map((d) => {
          const items = byDate.get(d) ?? [];
          const rel = relativeDay(d, fmt.today);
          return (
            <li key={d} className="px-4 py-3 sm:px-5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className={cn("text-sm font-semibold", items.length ? "text-foreground" : "text-muted-foreground")}>{longDay(d, fmt.locale)}</h3>
                {rel ? <span className={cn("shrink-0 text-xs font-medium", d === fmt.today ? "text-primary" : "text-muted-foreground")}>{rel}</span> : null}
              </div>
              {items.length ? (
                <ul className="divide-y divide-border">
                  {items.map((o) => (
                    <OccurrenceItem key={`${o.billId}:${o.dueDate}`} occurrence={o} />
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">No bills</p>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
