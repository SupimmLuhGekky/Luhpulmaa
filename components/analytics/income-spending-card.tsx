"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { ChartShell } from "@/components/charts/chart-shell";
import { useFormat } from "@/components/providers/format-provider";
import type { Analytics } from "@/lib/analytics/service";
import { formatMonthKey, type LocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { bucketSpan, formatDateRange, trimBeforeHistory, type Bucket, type SeriesPoint } from "./format";

/** Validated pair (blue / amber): money in and money out, the same in every analytics chart. */
export const ANALYTICS_COLORS = {
  income: "var(--chart-2)",
  spending: "var(--chart-3)",
  previous: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)",
} as const;

interface ChartPoint extends SeriesPoint {
  tick: string;
  title: string;
}

function TooltipBody({ point }: { point: ChartPoint }) {
  const fmt = useFormat();
  const net = point.income - point.spending;
  return (
    <div className="min-w-44 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-medium text-foreground">{point.title}</p>
      {[
        { label: "Income", value: point.income, color: ANALYTICS_COLORS.income },
        { label: "Spending", value: point.spending, color: ANALYTICS_COLORS.spending },
      ].map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} />
            {r.label}
          </span>
          <span className="tabular font-medium text-foreground">{fmt.money(r.value)}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1">
        <span className="pl-3.5 text-muted-foreground">Difference</span>
        <span className="tabular font-medium text-foreground">{fmt.money(net, { signed: true })}</span>
      </div>
    </div>
  );
}

function Chart({ points, label, height }: { points: ChartPoint[]; label: string; height: number }) {
  const fmt = useFormat();
  const ticks = new Map(points.map((p) => [p.period, p.tick]));
  return (
    <ChartShell
      label={label}
      height={height}
      table={{
        columns: ["Period", "Income", "Spending", "Difference"],
        rows: points.map((p) => [p.title, fmt.money(p.income), fmt.money(p.spending), fmt.money(p.income - p.spending, { signed: true })]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap={points.length > 16 ? "16%" : "30%"}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="period"
            tickFormatter={(v) => ticks.get(String(v)) ?? String(v)}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            interval="preserveStartEnd"
            minTickGap={14}
          />
          <YAxis width={60} tickFormatter={(v) => fmt.money(Number(v), { compact: true })} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.55 }} content={({ active, payload }) => (active && payload?.[0] ? <TooltipBody point={payload[0].payload as ChartPoint} /> : null)} />
          <Bar dataKey="income" name="Income" fill={ANALYTICS_COLORS.income} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          <Bar dataKey="spending" name="Spending" fill={ANALYTICS_COLORS.spending} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

const BUCKET_WORD: Record<Bucket, string> = { day: "By day", week: "By week", month: "By month" };

/**
 * Income and spending over the selected period (bucketed by day, week or month),
 * or month by month over the last 12 months. Periods before the first transaction
 * are left out rather than drawn as zero.
 */
export function IncomeSpendingCard({ data, className }: { data: Analytics; className?: string }) {
  const fmt = useFormat();
  const [view, setView] = React.useState<"period" | "year">("period");
  const r = data.range;
  const since = r.dataSince;
  const yearStart: LocalDate = `${data.monthly[0]?.period ?? fmt.today.slice(0, 7)}-01`;

  const { points, bucket, span } = React.useMemo(() => {
    const bucket: Bucket = view === "period" ? r.bucket : "month";
    const clip = view === "period" ? { from: r.from, to: r.to } : { from: yearStart, to: fmt.today };
    const source = trimBeforeHistory(view === "period" ? data.series : data.monthly, bucket, since);
    const points: ChartPoint[] = source.map((p) => {
      const { start, end } = bucketSpan(p.period, bucket, clip);
      if (bucket === "day") return { ...p, tick: fmt.date(start, "monthDay"), title: fmt.date(start, "weekdayShort") };
      if (bucket === "week") return { ...p, tick: fmt.date(start, "monthDay"), title: formatDateRange(start, end, fmt.locale, { year: false }) };
      const month = formatMonthKey(p.period, fmt.locale);
      const partial = end < bucketSpan(p.period, "month", { from: "0000-01-01", to: "9999-12-31" }).end;
      return { ...p, tick: fmt.date(start, "month"), title: partial ? `${month} (to ${fmt.date(end, "monthDay")})` : month };
    });
    const first = points[0] ? bucketSpan(points[0].period, bucket, clip).start : clip.from;
    return { points, bucket, span: { from: first, to: clip.to } };
  }, [view, r, data.series, data.monthly, since, yearStart, fmt]);

  const income = points.reduce((a, p) => a + p.income, 0);
  const spending = points.reduce((a, p) => a + p.spending, 0);
  const trimmed = since !== null && since > (view === "period" ? r.from : yearStart);
  const rangeText = formatDateRange(span.from, span.to, fmt.locale);

  return (
    <Card className={cn("min-w-0 p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Income and spending</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {BUCKET_WORD[bucket]}, {rangeText}
          </p>
        </div>
        <Segmented<"period" | "year">
          size="sm"
          value={view}
          onChange={setView}
          aria-label="Time span"
          options={[
            { value: "period", label: r.label },
            { value: "year", label: "Last 12 months" },
          ]}
        />
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        {[
          { label: "Income", value: income, color: ANALYTICS_COLORS.income },
          { label: "Spending", value: spending, color: ANALYTICS_COLORS.spending },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
              {s.label}
            </dt>
            <dd className="tabular font-semibold text-foreground">{fmt.money(s.value)}</dd>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">Difference</dt>
          <dd className={cn("tabular font-semibold", income - spending < 0 ? "text-danger" : "text-foreground")}>{fmt.money(income - spending, { signed: true })}</dd>
        </div>
      </dl>

      <div className="mt-3 -mx-1">
        <Chart points={points} label={`Income and spending ${BUCKET_WORD[bucket].toLowerCase()}, ${rangeText}`} height={260} />
      </div>
      {trimmed && since ? <p className="mt-2 text-xs text-muted-foreground">Your transactions start on {fmt.date(since, "medium")}, so earlier dates aren&apos;t shown.</p> : null}
    </Card>
  );
}
