"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Equal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useFormat } from "@/components/providers/format-provider";
import type { Analytics } from "@/lib/analytics/service";
import { cn } from "@/lib/utils";
import { completeMonthsSince } from "./format";

function Kpi({ label, value, tone, children }: { label: string; value: string; tone?: "danger"; children?: React.ReactNode }) {
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2>
      <p className={cn("tabular mt-1 truncate text-xl font-semibold tracking-tight sm:text-2xl", tone === "danger" ? "text-danger" : "text-foreground")}>{value}</p>
      {children ? <div className="mt-1 text-xs text-muted-foreground">{children}</div> : null}
    </Card>
  );
}

/** "$149.58 (4%) more" with an arrow; the comparison is spelled out for screen readers. */
function Change({ current, previous, comparisonLabel }: { current: number; previous: number; comparisonLabel: string }) {
  const fmt = useFormat();
  const delta = current - previous;
  if (delta === 0) {
    return (
      <p className="flex items-center gap-1">
        <Equal className="size-3.5 shrink-0" aria-hidden />
        Same as {comparisonLabel}
      </p>
    );
  }
  const Icon = delta > 0 ? ArrowUpRight : ArrowDownRight;
  const pct = previous > 0 ? Math.round((Math.abs(delta) / previous) * 100) : null;
  return (
    <p className="flex items-start gap-1">
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="tabular font-medium text-foreground">{fmt.money(Math.abs(delta))}</span>
        {pct !== null && pct > 0 ? <span className="tabular"> ({pct}%)</span> : null} {delta > 0 ? "more" : "less"}
        <span className="sr-only"> than {comparisonLabel}</span>
      </span>
    </p>
  );
}

/** Income, spending, what's left and daily spending for the period, with changes vs the comparison period. */
export function AnalyticsKpis({ data }: { data: Analytics }) {
  const fmt = useFormat();
  const m = data.metrics;
  const r = data.range;
  const comparable = r.comparison !== "none";
  const months = completeMonthsSince(data.monthly, r.dataSince, fmt.today);
  const noPrevious = <p>No earlier data to compare</p>;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <Kpi label="Income" value={fmt.money(m.income)}>
        {comparable ? <Change current={m.income} previous={m.previous.income} comparisonLabel={r.comparisonLabel} /> : noPrevious}
      </Kpi>
      <Kpi label="Spending" value={fmt.money(m.spending)}>
        {comparable ? <Change current={m.spending} previous={m.previous.spending} comparisonLabel={r.comparisonLabel} /> : noPrevious}
      </Kpi>
      <Kpi label="Left over" value={fmt.money(m.savings)} tone={m.savings < 0 ? "danger" : undefined}>
        {m.income <= 0 ? (
          <p>No income recorded</p>
        ) : m.savings >= 0 ? (
          <p>
            <span className="tabular font-medium text-foreground">{Math.round(m.savingsRateBps / 100)}%</span> of income kept
          </p>
        ) : (
          <p>Spending was higher than income</p>
        )}
      </Kpi>
      <Kpi label="Spending per day" value={fmt.money(m.averageDailySpending)}>
        {r.coveredFrom > r.from ? (
          <p>
            Over {r.coveredDays} day{r.coveredDays === 1 ? "" : "s"}, since your first transaction on {fmt.date(r.coveredFrom, "monthDay")}
          </p>
        ) : months > 0 && m.averageMonthlySpending > 0 ? (
          <p>
            Monthly average <span className="tabular font-medium text-foreground">{fmt.money(m.averageMonthlySpending, { wholeDollars: true })}</span>
            <span className="text-muted-foreground"> · last {months === 1 ? "full month" : `${months} full months`}</span>
          </p>
        ) : (
          <p>
            Over {r.days} day{r.days === 1 ? "" : "s"}
          </p>
        )}
      </Kpi>
    </div>
  );
}
