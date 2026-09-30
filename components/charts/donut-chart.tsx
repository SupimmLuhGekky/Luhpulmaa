"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useFormat } from "@/components/providers/format-provider";
import { ChartShell, ChartTooltip } from "./chart-shell";

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

/** Category share donut with the total in the centre (values in cents). */
export function DonutChart({ label, data, height = 200, centerLabel }: { label: string; data: DonutSlice[]; height?: number; centerLabel?: string }) {
  const f = useFormat();
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <ChartShell label={label} height={height} table={{ columns: ["Category", "Amount"], rows: data.map((d) => [d.name, f.money(d.value)]) }}>
      <div className="relative h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTooltip
                    title={String(payload[0].name)}
                    rows={[{ label: "Spent", value: f.money(Number(payload[0].value)) }, { label: "Share", value: total ? `${Math.round((Number(payload[0].value) * 100) / total)}%` : "—" }]}
                  />
                ) : null
              }
            />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="96%" paddingAngle={data.length > 1 ? 1.5 : 0} stroke="none" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-muted-foreground">{centerLabel ?? "Total"}</span>
          <span className="tabular text-base font-semibold">{f.money(total, { wholeDollars: true })}</span>
        </div>
      </div>
    </ChartShell>
  );
}
