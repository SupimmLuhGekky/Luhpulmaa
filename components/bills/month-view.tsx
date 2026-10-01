"use client";

import * as React from "react";
import { useFormat } from "@/components/providers/format-provider";
import { addDays, type LocalDate } from "@/lib/dates";
import { monthGrid, type OccurrenceStatus } from "@/lib/bills/calendar";
import { cn } from "@/lib/utils";
import { useBillActions } from "./bill-actions";
import { STATUS_META } from "./status";
import type { Occurrence } from "./types";

/** Chips shown per day from `md` up; the rest are summarised as "+N more". */
const MAX_CHIPS = 3;

function utc(d: LocalDate) {
  return new Date(`${d}T00:00:00Z`);
}

export function groupByDate(list: Occurrence[]) {
  const map = new Map<LocalDate, Occurrence[]>();
  for (const o of list) {
    const day = map.get(o.dueDate);
    if (day) day.push(o);
    else map.set(o.dueDate, [o]);
  }
  return map;
}

/**
 * Month grid. Each day is one button in a roving-tabindex grid (arrows move by
 * day/week, Home/End to the week's ends, Page Up/Down change month). Phones show
 * status dots; wider screens show bill chips and the day's total.
 */
export function MonthView({ date, weekStartsOn, occurrences, selected, onSelect, onShift }: {
  date: LocalDate;
  weekStartsOn: number;
  occurrences: Occurrence[];
  selected: LocalDate;
  onSelect: (date: LocalDate) => void;
  onShift: (delta: number) => void;
}) {
  const fmt = useFormat();
  const { resolve, statusOf } = useBillActions();
  const weeks = React.useMemo(() => monthGrid(date, weekStartsOn), [date, weekStartsOn]);
  const days = React.useMemo(() => weeks.flat(), [weeks]);
  const byDate = React.useMemo(() => groupByDate(occurrences), [occurrences]);
  const month = date.slice(0, 7);
  const refs = React.useRef(new Map<LocalDate, HTMLButtonElement>());
  const focusTarget = React.useRef<LocalDate | null>(null);

  React.useEffect(() => {
    if (focusTarget.current === selected) {
      refs.current.get(selected)?.focus();
      focusTarget.current = null;
    }
  }, [selected]);

  const names = React.useMemo(() => {
    const narrow = new Intl.DateTimeFormat(fmt.locale, { weekday: "narrow", timeZone: "UTC" });
    const short = new Intl.DateTimeFormat(fmt.locale, { weekday: "short", timeZone: "UTC" });
    const long = new Intl.DateTimeFormat(fmt.locale, { weekday: "long", timeZone: "UTC" });
    return weeks[0].map((d) => ({ narrow: narrow.format(utc(d)), short: short.format(utc(d)), long: long.format(utc(d)) }));
  }, [fmt.locale, weeks]);

  const dayLabel = React.useMemo(() => new Intl.DateTimeFormat(fmt.locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }), [fmt.locale]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = days.indexOf(selected);
    if (i < 0) return;
    let target: LocalDate | undefined;
    switch (e.key) {
      case "ArrowLeft":
        target = addDays(selected, -1);
        break;
      case "ArrowRight":
        target = addDays(selected, 1);
        break;
      case "ArrowUp":
        target = addDays(selected, -7);
        break;
      case "ArrowDown":
        target = addDays(selected, 7);
        break;
      case "Home":
        target = days[i - (i % 7)];
        break;
      case "End":
        target = days[i - (i % 7) + 6];
        break;
      case "PageUp":
      case "PageDown":
        e.preventDefault();
        onShift(e.key === "PageUp" ? -1 : 1);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (target && days.includes(target)) {
      focusTarget.current = target;
      onSelect(target);
    }
  };

  return (
    <div role="grid" aria-label={`Bills in ${fmt.date(`${month}-01`, "monthYear")}`} aria-readonly="true" onKeyDown={onKeyDown} className="overflow-hidden rounded-lg border border-border">
      <div role="row" className="grid grid-cols-7 border-b border-border bg-subtle">
        {names.map((n) => (
          <div key={n.long} role="columnheader" aria-label={n.long} className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="sm:hidden" aria-hidden>
              {n.narrow}
            </span>
            <span className="hidden sm:inline" aria-hidden>
              {n.short}
            </span>
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} role="row" className="grid grid-cols-7 border-b border-border last:border-b-0">
          {week.map((d) => {
            const items = byDate.get(d) ?? [];
            const statuses: OccurrenceStatus[] = items.map((o) => statusOf(o));
            const total = items.reduce((sum, o) => sum + resolve(o).amountCents, 0);
            const inMonth = d.slice(0, 7) === month;
            const isToday = d === fmt.today;
            const isSelected = d === selected;
            const overdue = statuses.filter((s) => s === "overdue").length;
            const paid = statuses.filter((s) => s === "paid").length;
            const label = [
              `${dayLabel.format(utc(d))}${isToday ? ", today" : ""}.`,
              items.length
                ? `${items.length} bill${items.length === 1 ? "" : "s"}, ${fmt.money(total)}${overdue ? `, ${overdue} overdue` : ""}${paid ? `, ${paid} paid` : ""}.`
                : "No bills.",
            ].join(" ");
            return (
              <div key={d} role="gridcell" aria-selected={isSelected} className="min-w-0 border-r border-border last:border-r-0">
                <button
                  ref={(el) => {
                    if (el) refs.current.set(d, el);
                    else refs.current.delete(d);
                  }}
                  type="button"
                  tabIndex={isSelected ? 0 : -1}
                  aria-label={label}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => onSelect(d)}
                  className={cn(
                    "flex h-full min-h-14 w-full min-w-0 flex-col gap-1 p-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-20 md:min-h-24 md:p-1.5",
                    !inMonth && "bg-subtle/60",
                    isSelected && "bg-primary-soft hover:bg-primary-soft",
                  )}
                >
                  <span className="flex min-w-0 items-center justify-between gap-1">
                    <span
                      className={cn(
                        "tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                        isToday ? "bg-primary font-semibold text-primary-foreground" : isSelected ? "font-semibold text-primary" : inMonth ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {Number(d.slice(8, 10))}
                    </span>
                    {items.length ? <span className="tabular hidden truncate text-[11px] text-muted-foreground lg:inline">{fmt.money(total)}</span> : null}
                  </span>
                  {items.length ? (
                    <>
                      <span className="flex flex-wrap items-center justify-center gap-0.5 md:hidden" aria-hidden>
                        {statuses.slice(0, 3).map((s, i) => (
                          <span key={i} className={cn("size-1.5 rounded-full", STATUS_META[s].dot)} />
                        ))}
                        {items.length > 3 ? <span className="text-[10px] leading-none text-muted-foreground">+</span> : null}
                      </span>
                      <span className="hidden min-w-0 flex-col gap-0.5 md:flex" aria-hidden>
                        {items.slice(0, MAX_CHIPS).map((o, i) => {
                          const meta = STATUS_META[statuses[i]];
                          const Icon = meta.icon;
                          return (
                            <span key={o.billId} className={cn("flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium leading-4", meta.chip)}>
                              {Icon ? <Icon className="size-3 shrink-0" /> : <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />}
                              <span className="truncate">{o.name}</span>
                            </span>
                          );
                        })}
                        {items.length > MAX_CHIPS ? <span className="px-1 text-[11px] text-muted-foreground">+{items.length - MAX_CHIPS} more</span> : null}
                      </span>
                    </>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
