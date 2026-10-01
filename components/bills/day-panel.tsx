"use client";

import { useFormat } from "@/components/providers/format-provider";
import { daysBetween, type LocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useBillActions } from "./bill-actions";
import { OccurrenceItem } from "./occurrence-item";
import type { Occurrence } from "./types";

/** "Today", "Tomorrow", "In 3 days", "2 days ago"… or null when a plain date says it better. */
export function relativeDay(date: LocalDate, today: LocalDate): string | null {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff <= 6) return `In ${diff} days`;
  if (diff < -1 && diff >= -6) return `${-diff} days ago`;
  return null;
}

export function longDay(date: LocalDate, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** Bills on the day selected in the month grid. */
export function DayPanel({ date, occurrences, className }: { date: LocalDate; occurrences: Occurrence[]; className?: string }) {
  const fmt = useFormat();
  const { resolve } = useBillActions();
  const items = occurrences.filter((o) => o.dueDate === date);
  const total = items.reduce((sum, o) => sum + resolve(o).amountCents, 0);
  const rel = relativeDay(date, fmt.today);
  return (
    <section aria-labelledby="bill-day-heading" className={cn("min-w-0 px-4 py-4 sm:px-5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="bill-day-heading" className="text-sm font-semibold text-foreground">
          {longDay(date, fmt.locale)}
        </h3>
        {rel ? <span className="shrink-0 text-xs font-medium text-muted-foreground">{rel}</span> : null}
      </div>
      {items.length ? (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {items.length} bill{items.length === 1 ? "" : "s"} · <span className="tabular">{fmt.money(total)}</span>
          </p>
          <ul className="mt-1 divide-y divide-border">
            {items.map((o) => (
              <OccurrenceItem key={`${o.billId}:${o.dueDate}`} occurrence={o} layout="panel" />
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-[13px] text-muted-foreground">No bills due this day.</p>
      )}
    </section>
  );
}
