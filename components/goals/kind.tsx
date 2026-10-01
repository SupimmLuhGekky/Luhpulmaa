import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Planned allocations and actual transfers always look different: actual money is a
 * solid teal fill, planned money is a hatched purple fill (earmarked, nothing moved).
 * The hatch keeps them apart without colour too (colour-blind readers, print).
 */
export const ACTUAL_COLOR = "var(--chart-1)";
export const PLANNED_COLOR = "var(--chart-4)";

export const PLANNED_FILL = `repeating-linear-gradient(135deg, ${PLANNED_COLOR} 0 5px, color-mix(in oklab, ${PLANNED_COLOR} 55%, var(--card)) 5px 8px)`;

export const KIND_LABEL = { actual: "Actual", planned: "Planned" } as const;

export const KIND_EXPLANATION = "Actual is money you moved yourself. Planned is money earmarked by you, a plan or an automation — nothing has moved.";

export function KindSwatch({ kind, className }: { kind: "actual" | "planned"; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", className)} style={kind === "actual" ? { backgroundColor: ACTUAL_COLOR } : { backgroundImage: PLANNED_FILL }} />;
}

/** "■ Actual $1,500.00  ▨ Planned $0.00" — labels and amounts in text colours, the swatch carries identity. */
export function KindLegend({ actual, planned, money, className, size = "sm" }: { actual: number; planned: number; money: (cents: number) => string; className?: string; size?: "sm" | "md" }) {
  return (
    <dl className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", size === "sm" ? "text-xs" : "text-[13px]", className)}>
      {(["actual", "planned"] as const).map((k) => (
        <div key={k} className="inline-flex items-center gap-1.5">
          <KindSwatch kind={k} />
          <dt className="text-muted-foreground">{KIND_LABEL[k]}</dt>
          <dd className="tabular font-medium text-foreground">{money(k === "actual" ? actual : planned)}</dd>
        </div>
      ))}
    </dl>
  );
}
