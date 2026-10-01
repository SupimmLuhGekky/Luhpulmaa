"use client";

import * as React from "react";
import { Area, AreaChart as RAreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormat } from "@/components/providers/format-provider";
import { ChartShell, ChartTooltip } from "./chart-shell";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export interface AreaChartProps {
  label: string;
  data: Record<string, string | number | null>[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  /** Formats x values (dates) for axis/tooltip. */
  formatX?: (v: string) => string;
  referenceY?: { value: number; label: string };
  stacked?: boolean;
}

/** Money time-series (values in cents). */
export function AreaChart({ label, data, xKey, series, height = 240, formatX, referenceY, stacked }: AreaChartProps) {
  const f = useFormat();
  const fx = formatX ?? ((v: string) => f.date(v, "monthDay"));
  const id = React.useId().replace(/:/g, "");
  return (
    <ChartShell
      label={label}
      height={height}
      table={{ columns: [xKey.charAt(0).toUpperCase() + xKey.slice(1), ...series.map((s) => s.label)], rows: data.map((d) => [fx(String(d[xKey])), ...series.map((s) => f.money(Number(d[s.key] ?? 0)))]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RAreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
          <XAxis dataKey={xKey} tickFormatter={(v) => fx(String(v))} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={24} />
          <YAxis
            width={64}
            tickFormatter={(v) => f.money(Number(v), { compact: true })}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            content={({ active, payload, label: l }) =>
              active && payload?.length ? (
                <ChartTooltip title={fx(String(l))} rows={payload.map((p) => ({ label: series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey), value: f.money(Number(p.value ?? 0)), color: series.find((s) => s.key === p.dataKey)?.color }))} />
              ) : null
            }
          />
          {referenceY ? <ReferenceLine y={referenceY.value} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: referenceY.label, position: "insideTopRight", fontSize: 11, fill: "var(--warning)" }} /> : null}
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#g-${id}-${s.key})`} stackId={stacked ? "1" : undefined} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          ))}
        </RAreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

