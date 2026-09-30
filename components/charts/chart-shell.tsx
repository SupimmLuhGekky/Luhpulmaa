import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps a visual chart with an accessible text alternative: charts are hidden from
 * screen readers and the same data is exposed as a visually-hidden table.
 */
export function ChartShell({ label, height = 240, table, children, className }: {
  label: string;
  height?: number;
  table: { columns: string[]; rows: (string | number)[][] };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("relative w-full min-w-0", className)} style={{ height }}>
      <div aria-hidden className="h-full w-full">
        {children}
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

export function ChartTooltip({ title, rows }: { title: React.ReactNode; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="min-w-36 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-medium text-foreground">{title}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {r.color ? <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} /> : null}
            {r.label}
          </span>
          <span className="tabular font-medium text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
