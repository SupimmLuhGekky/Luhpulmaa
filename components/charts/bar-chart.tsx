"use client";

import { Bar, BarChart as RBarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormat } from "@/components/providers/format-provider";
import { ChartShell, ChartTooltip } from "./chart-shell";
import type { SeriesDef } from "./area-chart";

export function BarChart({ label, data, xKey, series, height = 240, formatX, stacked, showLegend = true }: {
  label: string;
  data: Record<string, string | number | null>[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  formatX?: (v: string) => string;
  stacked?: boolean;
  showLegend?: boolean;
}) {
  const f = useFormat();
  const fx = formatX ?? ((v: string) => v);
  return (
    <ChartShell
      label={label}
      height={height}
      table={{ columns: [xKey, ...series.map((s) => s.label)], rows: data.map((d) => [fx(String(d[xKey])), ...series.map((s) => f.money(Number(d[s.key] ?? 0)))]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey={xKey} tickFormatter={(v) => fx(String(v))} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={8} />
          <YAxis width={64} tickFormatter={(v) => f.money(Number(v), { compact: true })} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload, label: l }) =>
              active && payload?.length ? (
                <ChartTooltip title={fx(String(l))} rows={payload.map((p) => ({ label: series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey), value: f.money(Number(p.value ?? 0)), color: series.find((s) => s.key === p.dataKey)?.color }))} />
              ) : null
            }
          />
          {showLegend && series.length > 1 ? <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} /> : null}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={stacked ? 0 : [4, 4, 0, 0]} maxBarSize={28} stackId={stacked ? "a" : undefined} isAnimationActive={false} />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
