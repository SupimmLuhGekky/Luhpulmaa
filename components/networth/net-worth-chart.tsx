"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartShell } from "@/components/charts/chart-shell";
import { useFormat } from "@/components/providers/format-provider";
import { daysBetween } from "@/lib/dates";

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

/** Net worth line (same hue as balances elsewhere); assets and debts use the money-in / money-out pair. */
export const NET_WORTH_COLORS = { netWorth: "var(--chart-1)", assets: "var(--chart-2)", debts: "var(--chart-3)" } as const;

function TooltipBody({ point, isToday }: { point: NetWorthPoint; isToday: boolean }) {
  const fmt = useFormat();
  return (
    <div className="min-w-48 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-pop">
      <p className="font-medium text-foreground">{isToday ? `Today, ${fmt.date(point.date, "monthDay")}` : fmt.date(point.date, "medium")}</p>
      <div className="mt-1 flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: NET_WORTH_COLORS.netWorth }} />
          Net worth
        </span>
        <span className="tabular font-semibold text-foreground">{fmt.money(point.netWorth)}</span>
      </div>
      <div className="mt-1 space-y-0.5 border-t border-border pt-1">
        <div className="flex items-center justify-between gap-4">
          <span className="pl-[1.125rem] text-muted-foreground">Assets</span>
          <span className="tabular text-foreground">{fmt.money(point.assets)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="pl-[1.125rem] text-muted-foreground">Debts</span>
          <span className="tabular text-foreground">{fmt.money(point.liabilities)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Daily net worth as an area from zero (so the size of a change reads honestly),
 * with assets and debts in the tooltip and a table copy for screen readers.
 */
export function NetWorthChart({ points, today, height = 280 }: { points: NetWorthPoint[]; today: string; height?: number }) {
  const fmt = useFormat();
  const gradientId = `nw-${React.useId().replace(/:/g, "")}`;
  const span = points.length > 1 ? daysBetween(points[0].date, points[points.length - 1].date) : 0;
  const tick = (v: string) => (span > 370 ? new Intl.DateTimeFormat(fmt.locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${v}T00:00:00Z`)) : fmt.date(v, "monthDay"));
  const negative = points.some((p) => p.netWorth < 0);
  // Long ranges: the screen-reader table samples about 60 evenly spaced days (always keeping the last).
  const step = Math.max(1, Math.ceil(points.length / 60));
  const tableRows = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  return (
    <ChartShell
      label={step > 1 ? `Net worth, every ${step} days` : "Net worth by day"}
      height={height}
      table={{
        columns: ["Date", "Net worth", "Assets", "Debts"],
        rows: tableRows.map((p) => [fmt.date(p.date, "medium"), fmt.money(p.netWorth), fmt.money(p.assets), fmt.money(p.liabilities)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={NET_WORTH_COLORS.netWorth} stopOpacity={0.22} />
              <stop offset="100%" stopColor={NET_WORTH_COLORS.netWorth} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={(v) => tick(String(v))} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} interval="preserveStartEnd" minTickGap={36} />
          <YAxis
            width={64}
            domain={[(min: number) => Math.min(0, min), "auto"]}
            tickFormatter={(v) => fmt.money(Number(v), { compact: true })}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as NetWorthPoint | undefined) : undefined;
              return p ? <TooltipBody point={p} isToday={p.date === today} /> : null;
            }}
          />
          {negative ? <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} /> : null}
          <Area
            type="linear"
            dataKey="netWorth"
            stroke={NET_WORTH_COLORS.netWorth}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: NET_WORTH_COLORS.netWorth }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
