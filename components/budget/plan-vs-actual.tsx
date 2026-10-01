"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartShell, ChartTooltip } from "@/components/charts/chart-shell";
import { Card, CardHeading } from "@/components/ui/card";
import { useFormat } from "@/components/providers/format-provider";
import { formatDate } from "@/lib/dates";
import { periodLabel } from "@/lib/budget/periods";
import type { BudgetHistoryPoint } from "@/lib/budget/service";
import { niceTicks } from "./nice-ticks";

const PLANNED = "var(--chart-4)";
const ACTUAL = "var(--chart-1)";

/** Planned vs actual spending over recent budgets of the same kind (monthly or weekly). */
export function PlanVsActual({ history, period }: { history: BudgetHistoryPoint[]; period: "MONTHLY" | "WEEKLY" }) {
  const fmt = useFormat();
  const ref = React.useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  if (history.length < 2) return null;
  const unit = period === "MONTHLY" ? "Month" : "Week";
  // Axis: "Jul 2026, Aug, Sep…" (the year only where it starts or changes); tooltip and table use full labels.
  const data = history.map((h, i) => {
    const newYear = i === 0 || history[i - 1].start.slice(0, 4) !== h.start.slice(0, 4);
    return {
      label: periodLabel(period, h.start, h.end, fmt.locale),
      tick: period === "MONTHLY" ? `${formatDate(h.start, "month", fmt.locale)}${newYear ? ` ${h.start.slice(0, 4)}` : ""}` : formatDate(h.start, "monthDay", fmt.locale),
      planned: h.planned,
      spent: h.spent,
    };
  });
  const ticks = niceTicks(Math.max(...history.flatMap((h) => [h.planned, h.spent])));
  const current = history.find((h) => h.start <= fmt.today && fmt.today <= h.end);
  const upcoming = history.filter((h) => h.start > fmt.today);
  const finished = history.filter((h) => h.end < fmt.today);
  const over = finished.filter((h) => h.spent > h.planned).length;
  // Thin bars (max 24px) sitting side by side in each group, at any width.
  const barSize = Math.max(6, Math.min(24, Math.floor((((width || 600) - 56) / data.length) * 0.28)));

  return (
    <Card className="h-full">
      <CardHeading
        title="Plan vs actual"
        description={`Planned spending against what you actually spent, last ${history.length} ${period === "MONTHLY" ? "months" : "weeks"} with a budget.`}
      />
      <div className="px-5" ref={ref}>
        <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: PLANNED }} /> Planned
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: ACTUAL }} /> Actual
          </span>
        </div>
        <ChartShell
          label={`Planned vs actual spending by ${unit.toLowerCase()}`}
          height={220}
          table={{ columns: [unit, "Planned", "Actual"], rows: data.map((d) => [d.label, fmt.money(d.planned), fmt.money(d.spent)]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="tick" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis
                width={52}
                ticks={ticks}
                domain={[0, ticks[ticks.length - 1]]}
                tickFormatter={(v) => fmt.money(Number(v), { compact: true })}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  const diff = row.planned - row.spent;
                  return (
                    <ChartTooltip
                      title={row.label}
                      rows={[
                        { label: "Planned", value: fmt.money(row.planned), color: PLANNED },
                        { label: "Actual", value: fmt.money(row.spent), color: ACTUAL },
                        { label: diff >= 0 ? "Under plan" : "Over plan", value: fmt.money(Math.abs(diff)) },
                      ]}
                    />
                  );
                }}
              />
              <Bar dataKey="planned" name="Planned" fill={PLANNED} radius={[4, 4, 0, 0]} barSize={barSize} isAnimationActive={false} />
              <Bar dataKey="spent" name="Actual" fill={ACTUAL} radius={[4, 4, 0, 0]} barSize={barSize} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>
      </div>
      <p className="mt-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        {finished.length ? (over ? `Spending went over the plan in ${over} of ${finished.length} finished ${finished.length === 1 ? unit.toLowerCase() : `${unit.toLowerCase()}s`}. ` : `Spending stayed within the plan in every finished ${unit.toLowerCase()}. `) : null}
        Planned counts category lines only; actual includes unbudgeted spending.
        {current ? ` ${periodLabel(period, current.start, current.end, fmt.locale)} is still in progress.` : ""}
        {upcoming.length ? ` ${upcoming.map((h) => periodLabel(period, h.start, h.end, fmt.locale)).join(", ")} ${upcoming.length === 1 ? "hasn't" : "haven't"} started.` : ""}
      </p>
    </Card>
  );
}

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
