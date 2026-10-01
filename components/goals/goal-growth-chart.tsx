"use client";

import * as React from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartShell, ChartTooltip } from "@/components/charts/chart-shell";
import { useFormat } from "@/components/providers/format-provider";
import { formatDate, type LocalDate } from "@/lib/dates";
import type { GrowthPoint } from "@/lib/goals/contributions";
import { dayNumber, fromDayNumber, timeTicks } from "@/lib/goals/timeline";
import { niceTicks } from "@/components/budget/nice-ticks";
import { ACTUAL_COLOR, KindSwatch, PLANNED_COLOR } from "./kind";

const MIN_SPAN_DAYS = 14;

interface Row {
  x: number;
  date: LocalDate;
  actual?: number;
  planned?: number;
  total?: number;
  /** Straight line from today's total to the target on the deadline (an estimate). */
  path?: number;
}

/**
 * Running total over time on a real time axis: actual money (solid) with planned
 * money stacked on top (hatched), the target as a dashed rule and, with a deadline,
 * the straight path still needed to get there.
 */
export function GoalGrowthChart({
  growth,
  target,
  deadline,
  today,
  showPath,
  height = 260,
}: {
  growth: GrowthPoint[];
  target: number;
  deadline: LocalDate | null;
  today: LocalDate;
  showPath: boolean;
  height?: number;
}) {
  const fmt = useFormat();
  const ref = React.useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const hatch = `hatch-${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const last = growth[growth.length - 1];
  const withPath = Boolean(showPath && deadline && last && deadline > today && last.total < target);
  const rows: Row[] = growth.map((p) => ({ x: dayNumber(p.date), date: p.date, actual: Math.max(0, p.actual), planned: Math.max(0, p.planned), total: p.total }));
  if (rows.length) {
    // Totals hold until the end of today: carry the last one a day further so the latest step has width.
    const endX = dayNumber(today) + 1;
    const tail = rows[rows.length - 1];
    if (tail.x < endX) rows.push({ ...tail, x: endX, date: today });
    // A brand-new goal gets two weeks of empty history so its first step is readable.
    if (endX - rows[0].x < MIN_SPAN_DAYS) rows.unshift({ x: endX - MIN_SPAN_DAYS, date: fromDayNumber(endX - MIN_SPAN_DAYS), actual: 0, planned: 0, total: 0 });
    if (withPath) {
      rows[rows.length - 1].path = last.total;
      rows.push({ x: dayNumber(deadline!), date: deadline!, path: target });
    }
  }
  // Draw a series only when it has money, so an all-actual goal has no purple edge on top.
  const hasActual = growth.some((p) => p.actual > 0);
  const hasPlanned = growth.some((p) => p.planned > 0);
  const fromX = rows[0]?.x ?? dayNumber(today);
  const toX = rows[rows.length - 1]?.x ?? fromX + 1;
  const { ticks, unit } = timeTicks(fromDayNumber(fromX), fromDayNumber(toX), width && width < 480 ? 3 : 6);
  const yTicks = niceTicks(Math.max(target, ...growth.map((p) => p.total)));
  const tickLabel = (d: LocalDate, i: number) =>
    unit === "day" ? formatDate(d, "monthDay", fmt.locale) : `${formatDate(d, "month", fmt.locale)}${i === 0 || d.slice(5, 7) === "01" ? ` ${d.slice(0, 4)}` : ""}`;

  return (
    <div ref={ref} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <KindSwatch kind="actual" /> Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <KindSwatch kind="planned" /> Planned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-muted-foreground" /> Target
        </span>
        {withPath ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dotted border-foreground/60" /> Path to deadline (estimate)
          </span>
        ) : null}
      </div>
      <ChartShell
        label="Amount set aside over time, actual and planned"
        height={height}
        table={{
          columns: ["Date", "Actual", "Planned", "Total"],
          rows: growth.map((p) => [fmt.date(p.date), fmt.money(p.actual), fmt.money(p.planned), fmt.money(p.total)]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
            <defs>
              <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={PLANNED_COLOR} fillOpacity={0.1} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={PLANNED_COLOR} strokeWidth="2.5" strokeOpacity={0.5} />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[fromX, toX]}
              ticks={ticks.map(dayNumber)}
              tickFormatter={(v: number) => tickLabel(fromDayNumber(v), ticks.indexOf(fromDayNumber(v)))}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              interval={0}
            />
            <YAxis
              width={56}
              ticks={yTicks}
              domain={[0, yTicks[yTicks.length - 1]]}
              tickFormatter={(v) => fmt.money(Number(v), { compact: true })}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <Tooltip
              cursor={{
                stroke: "var(--muted-foreground)",
                strokeWidth: 1,
                strokeDasharray: "3 3",
              }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Row;
                if (row.total === undefined) {
                  return <ChartTooltip title={`Deadline · ${fmt.date(row.date)}`} rows={[{ label: "Target", value: fmt.money(target) }]} />;
                }
                return (
                  <ChartTooltip
                    title={fmt.date(row.date)}
                    rows={[
                      { label: "Total", value: fmt.money(row.total) },
                      {
                        label: "Actual",
                        value: fmt.money(row.actual ?? 0),
                        color: ACTUAL_COLOR,
                      },
                      {
                        label: "Planned",
                        value: fmt.money(row.planned ?? 0),
                        color: PLANNED_COLOR,
                      },
                    ]}
                  />
                );
              }}
            />
            <ReferenceLine
              y={target}
              stroke="var(--muted-foreground)"
              strokeDasharray="5 4"
              strokeWidth={1.5}
              label={{
                value: `Target ${fmt.money(target, { compact: target >= 1_000_000 })}`,
                position: "insideTopLeft",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
            {hasActual ? (
              <Area
                type="stepAfter"
                dataKey="actual"
                stackId="kind"
                stroke={ACTUAL_COLOR}
                strokeWidth={2}
                fill={ACTUAL_COLOR}
                fillOpacity={0.2}
                dot={false}
                activeDot={
                  hasPlanned
                    ? false
                    : {
                        r: 4,
                        fill: ACTUAL_COLOR,
                        stroke: "var(--card)",
                        strokeWidth: 2,
                      }
                }
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
            {hasPlanned ? (
              <Area
                type="stepAfter"
                dataKey="planned"
                stackId="kind"
                stroke={PLANNED_COLOR}
                strokeWidth={2}
                fill={`url(#${hatch})`}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: PLANNED_COLOR,
                  stroke: "var(--card)",
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
            {withPath ? (
              <Line
                type="linear"
                dataKey="path"
                stroke="var(--foreground)"
                strokeOpacity={0.6}
                strokeWidth={2}
                strokeDasharray="2 4"
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartShell>
    </div>
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
