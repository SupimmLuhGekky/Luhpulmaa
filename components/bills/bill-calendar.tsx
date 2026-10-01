"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { useFormat } from "@/components/providers/format-provider";
import { useParamNavigation } from "@/components/analytics/use-param-navigation";
import { shiftDate, viewRange, type CalendarView } from "@/lib/bills/calendar";
import { endOfMonth, startOfMonth, type LocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DayPanel } from "./day-panel";
import { ListView } from "./list-view";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";
import type { Occurrence } from "./types";

/** The calendar period a view shows (the month view's grid also shows a few neighbouring days). */
export function periodOf(view: CalendarView, date: LocalDate, weekStartsOn: number) {
  return view === "week" ? viewRange("week", date, weekStartsOn) : { from: startOfMonth(date), to: endOfMonth(date) };
}

/**
 * Day selected when a month is shown: an explicit `?date=` day, else today when it
 * is in that month, else the month's first due date.
 */
function initialDay(date: LocalDate, today: LocalDate, occurrences: Occurrence[]): LocalDate {
  const month = date.slice(0, 7);
  if (date.slice(8) !== "01") return date;
  if (today.slice(0, 7) === month) return today;
  return occurrences.find((o) => o.dueDate.slice(0, 7) === month)?.dueDate ?? date;
}

function utc(d: LocalDate) {
  return new Date(`${d}T00:00:00Z`);
}

/** Toolbar (period navigation and view switch, kept in the URL) plus the active view. */
export function BillCalendar({ view, date, weekStartsOn, occurrences }: { view: CalendarView; date: LocalDate; weekStartsOn: number; occurrences: Occurrence[] }) {
  const fmt = useFormat();
  const { navigate, pending } = useParamNavigation();
  const anchor = `${view}:${date}`;
  const [selection, setSelection] = React.useState(() => ({ anchor, day: initialDay(date, fmt.today, occurrences) }));
  let selected = selection.day;
  if (selection.anchor !== anchor) {
    selected = initialDay(date, fmt.today, occurrences);
    setSelection({ anchor, day: selected });
  }

  const period = periodOf(view, date, weekStartsOn);
  const showsToday = fmt.today >= period.from && fmt.today <= period.to;
  const unit = view === "week" ? "week" : "month";
  const monthLabel = fmt.date(`${date.slice(0, 7)}-01`, "monthYear");
  const title =
    view === "week" ? new Intl.DateTimeFormat(fmt.locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).formatRange(utc(period.from), utc(period.to)) : monthLabel;

  const shift = (delta: number) => navigate({ date: shiftDate(view, date, delta) });
  const select = (day: LocalDate) => setSelection({ anchor, day });

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => shift(-1)} aria-label={`Previous ${unit}`}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => shift(1)} aria-label={`Next ${unit}`}>
            <ChevronRight />
          </Button>
          <h2 className="ml-1 truncate text-base font-semibold tracking-tight text-foreground" aria-live="polite">
            {title}
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => {
              setSelection({ anchor: `${view}:${fmt.today}`, day: fmt.today });
              navigate({ date: null });
            }}
            disabled={showsToday && (view !== "month" || selected === fmt.today)}
          >
            Today
          </Button>
        </div>
        <Segmented<CalendarView>
          size="sm"
          value={view}
          aria-label="Calendar view"
          onChange={(v) => {
            const next = view === "month" && v === "week" ? selected : date;
            navigate({ view: v === "month" ? null : v, date: next === fmt.today ? null : next });
          }}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
            { value: "list", label: "List" },
          ]}
        />
      </div>
      <div className={cn("transition-opacity", pending && "pointer-events-none opacity-60")} aria-busy={pending || undefined}>
        {view === "month" ? (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 p-2 sm:p-3">
              <MonthView date={date} weekStartsOn={weekStartsOn} occurrences={occurrences} selected={selected} onSelect={select} onShift={shift} />
            </div>
            <DayPanel date={selected} occurrences={occurrences} className="border-t border-border lg:border-l lg:border-t-0" />
          </div>
        ) : view === "week" ? (
          <WeekView date={date} weekStartsOn={weekStartsOn} occurrences={occurrences} />
        ) : (
          <ListView monthLabel={monthLabel} occurrences={occurrences} />
        )}
      </div>
    </Card>
  );
}
