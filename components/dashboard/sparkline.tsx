"use client";

import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

/** Minimal trend line (no axes). The accessible description is supplied by the caller. */
export function Sparkline({ data, color = "var(--chart-1)", height = 56, description }: { data: number[]; color?: string; height?: number; description: string }) {
  const id = React.useId().replace(/:/g, "");
  if (data.length < 2) return null;
  const points = data.map((v, i) => ({ i, v }));
  return (
    <figure className="w-full" style={{ height }} aria-label={description} role="img">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`s-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#s-${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
