"use client";

import * as React from "react";
import { CalendarDays, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFormat } from "@/components/providers/format-provider";
import type { AutomationPreview } from "@/lib/automation/service";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-subtle px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular text-foreground">{value}</p>
    </div>
  );
}

/** Results of a dry run. Nothing was changed: this only shows what would have happened. */
export function PreviewPanel({ preview }: { preview: AutomationPreview }) {
  const fmt = useFormat();

  if (preview.kind === "transactions") {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-muted-foreground">
          Since {fmt.date(preview.from)}, out of {preview.sampled.toLocaleString(fmt.locale)} {preview.sampled === 1 ? "transaction" : "transactions"}:
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Would match" value={preview.matched.toLocaleString(fmt.locale)} />
          <Stat label="Would change" value={preview.affected.toLocaleString(fmt.locale)} />
        </div>
        {preview.plannedCents > 0 ? (
          <p className="flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[13px] text-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <span>
              Would have planned <strong className="tabular">{fmt.money(preview.plannedCents)}</strong> for goals. Planned allocations only: no money moves.
            </span>
          </p>
        ) : null}
        {preview.examples.length ? (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{preview.matched > preview.examples.length ? `Latest ${preview.examples.length} matches` : "Matches"}</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {preview.examples.map((e) => (
                <li key={e.id} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{e.label}</span>
                    <span className="shrink-0 text-[13px] tabular text-foreground">{fmt.money(e.amountCents)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-muted-foreground">{fmt.date(e.date, "monthDay")}</span>
                    {e.effects.length ? (
                      e.effects.map((x, i) => (
                        <Badge key={i} variant="primary" className="whitespace-normal">
                          {x}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="neutral">Already like this</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No transactions in this period match. Try loosening the conditions.</p>
        )}
      </div>
    );
  }

  if (preview.kind === "schedule") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Would have run" value={`${preview.runs.length}×`} />
          <Stat label="Planned in total" value={fmt.money(preview.plannedCents)} />
        </div>
        {preview.runs.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {preview.runs.map((d) => (
              <li key={d}>
                <Badge variant="outline">
                  <CalendarDays aria-hidden /> {fmt.date(d, "monthDay")}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Choose when it runs to see the dates.</p>
        )}
        {preview.plannedPerRunCents > 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {fmt.money(preview.plannedPerRunCents)} planned each time. Planned allocations only: no money moves.
          </p>
        ) : null}
        {preview.notifies ? <p className="text-[13px] text-muted-foreground">You&apos;d get a notification each time.</p> : null}
      </div>
    );
  }

  if (preview.kind === "subscriptions") {
    return preview.detected.length ? (
      <div className="space-y-2">
        <p className="text-[13px] text-muted-foreground">
          {preview.detected.length} new {preview.detected.length === 1 ? "subscription was" : "subscriptions were"} detected since {fmt.date(preview.from)}. You&apos;d have been told about each.
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {preview.detected.map((s, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 truncate font-medium text-foreground">{s.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {fmt.money(s.amountCents)} · {fmt.date(s.date, "monthDay")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <p className="text-[13px] text-muted-foreground">No new subscriptions were detected since {fmt.date(preview.from)}.</p>
    );
  }

  // budget threshold
  if (!preview.month) return <p className="text-[13px] text-muted-foreground">You don&apos;t have a budget for this month yet, so nothing would trigger.</p>;
  if (!preview.thresholdPercent) return <p className="text-[13px] text-muted-foreground">Choose a threshold to see which budget lines it would catch.</p>;
  return preview.lines.length ? (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">
        This month, {preview.lines.length} budget {preview.lines.length === 1 ? "line is" : "lines are"} already at {preview.thresholdPercent}% or more:
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {preview.lines.map((l) => (
          <li key={l.name} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]">
            <span className="min-w-0 truncate font-medium text-foreground">{l.name}</span>
            <span className={l.usedPercent >= 100 ? "font-medium text-danger" : "text-warning"}>{l.usedPercent}% used</span>
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <p className="text-[13px] text-muted-foreground">No budget line has reached {preview.thresholdPercent}% yet this month.</p>
  );
}
