"use client";

import * as React from "react";
import { Area, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartShell } from "@/components/charts/chart-shell";
import { useFormat } from "@/components/providers/format-provider";
import type { CashFlowEvent } from "@/lib/finance/calculations";
import type { LocalDate } from "@/lib/dates";

export interface ForecastPoint {
  date: LocalDate;
  balance: number;
  inflow: number;
  outflow: number;
  /** Expected pay and other money in. */
  incoming: CashFlowEvent[];
  /** Bills, subscriptions and planned savings. */
  outgoing: CashFlowEvent[];
  /** Typical day-to-day spending spread over the day. */
  typical: number;
}

/** Validated pair: money in uses chart-2, money out uses the negative token; the balance line uses chart-1. */
export const FORECAST_COLORS = { balance: "var(--chart-1)", income: "var(--chart-2)", outflow: "var(--negative)", buffer: "var(--warning)" } as const;

const SIGN = { in: "+", out: "−" } as const;

function TooltipBody({ point }: { point: ForecastPoint }) {
  const fmt = useFormat();
  return (
    <div className="min-w-48 max-w-72 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-pop">
      <p className="font-medium text-foreground">{fmt.date(point.date, "weekdayShort")}</p>
      <div className="mt-1 flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: FORECAST_COLORS.balance }} />
          Estimated balance
        </span>
        <span className="tabular font-semibold text-foreground">{fmt.money(point.balance)}</span>
      </div>
      {point.incoming.length || point.outgoing.length || point.typical ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
          {point.incoming.map((e, i) => (
            <li key={`in-${i}`} className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: FORECAST_COLORS.income }} />
                <span className="truncate">{e.label}</span>
              </span>
              <span className="tabular shrink-0 text-foreground">
                {SIGN.in}
                {fmt.money(Math.abs(e.amount))}
              </span>
            </li>
          ))}
          {point.outgoing.map((e, i) => (
            <li key={`out-${i}`} className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: FORECAST_COLORS.outflow }} />
                <span className="truncate">{e.label}</span>
              </span>
              <span className="tabular shrink-0 text-foreground">
                {SIGN.out}
                {fmt.money(Math.abs(e.amount))}
              </span>
            </li>
          ))}
          {point.typical ? (
            <li className="flex items-center justify-between gap-4">
              <span className="pl-3.5 text-muted-foreground">Typical spending</span>
              <span className="tabular shrink-0 text-foreground">
                {SIGN.out}
                {fmt.money(point.typical)}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Estimated daily balance (area from zero) with paydays and bills marked on the
 * line and the cash buffer as a dashed reference. A table copy is exposed to
 * screen readers by ChartShell.
 */
export function CashFlowChart({ points, buffer, days, height = 280 }: { points: ForecastPoint[]; buffer: number; days: number; height?: number }) {
  const fmt = useFormat();
  const gradientId = `fc-${React.useId().replace(/:/g, "")}`;
  const tickFormat = (v: string) => (days <= 7 ? fmt.date(v, "weekdayShort").split(",")[0] + " " + Number(v.slice(8)) : fmt.date(v, "monthDay"));

  const renderMarker = (props: { cx?: number; cy?: number; index?: number; payload?: ForecastPoint }) => {
    const { cx, cy, index, payload } = props;
    const key = `m-${index}`;
    if (cx === undefined || cy === undefined || !payload) return <g key={key} />;
    const hasIn = payload.incoming.length > 0;
    const hasOut = payload.outgoing.length > 0;
    if (!hasIn && !hasOut) return <g key={key} />;
    const offset = hasIn && hasOut ? 4 : 0;
    return (
      <g key={key}>
        {hasOut ? <circle cx={cx + offset} cy={cy} r={4.5} fill={FORECAST_COLORS.outflow} stroke="var(--card)" strokeWidth={2} /> : null}
        {hasIn ? <circle cx={cx - offset} cy={cy} r={4.5} fill={FORECAST_COLORS.income} stroke="var(--card)" strokeWidth={2} /> : null}
      </g>
    );
  };

  return (
    <ChartShell
      label="Estimated daily balance"
      height={height}
      table={{
        columns: ["Date", "Estimated balance", "Money in", "Money out", "What happens"],
        rows: points.map((p) => [
          fmt.date(p.date, "medium"),
          fmt.money(p.balance),
          fmt.money(p.inflow),
          fmt.money(p.outflow),
          [...p.incoming, ...p.outgoing].map((e) => `${e.label} ${e.amount >= 0 ? "+" : "−"}${fmt.money(Math.abs(e.amount))}`).join("; ") || "Typical spending only",
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={FORECAST_COLORS.balance} stopOpacity={0.2} />
              <stop offset="100%" stopColor={FORECAST_COLORS.balance} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => tickFormat(String(v))}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            interval={days <= 7 ? 0 : "preserveStartEnd"}
            minTickGap={days <= 7 ? 4 : 32}
          />
          <YAxis
            width={64}
            domain={[(min: number) => Math.min(0, min), "auto"]}
            tickFormatter={(v) => fmt.money(Number(v), { compact: true })}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip cursor={{ stroke: "var(--border)", strokeWidth: 1 }} content={({ active, payload }) => (active && payload?.[0] ? <TooltipBody point={payload[0].payload as ForecastPoint} /> : null)} />
          {buffer > 0 ? (
            <ReferenceLine
              y={buffer}
              stroke={FORECAST_COLORS.buffer}
              strokeDasharray="5 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              label={{ value: `Buffer ${fmt.money(buffer, { compact: true })}`, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }}
            />
          ) : null}
          {points.some((p) => p.balance < 0) ? <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} /> : null}
          <Area
            type="linear"
            dataKey="balance"
            stroke={FORECAST_COLORS.balance}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={renderMarker}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: FORECAST_COLORS.balance }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

/** Legend for the forecast chart (identity is never colour alone: each entry is labelled). */
export function CashFlowLegend({ buffer }: { buffer: number }) {
  const fmt = useFormat();
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Chart legend">
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: FORECAST_COLORS.balance }} aria-hidden />
        Estimated balance
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: FORECAST_COLORS.income }} aria-hidden />
        Pay
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: FORECAST_COLORS.outflow }} aria-hidden />
        Bills, subscriptions and savings
      </li>
      {buffer > 0 ? (
        <li className="flex items-center gap-1.5">
          <span className="w-4 border-t-[1.5px] border-dashed" style={{ borderColor: FORECAST_COLORS.buffer }} aria-hidden />
          Cash buffer ({fmt.money(buffer)})
        </li>
      ) : null}
    </ul>
  );
}
