import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Label + large value + optional change indicator. */
export function Stat({ label, value, hint, change, changeLabel, positiveIsGood = true, className, size = "md" }: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  change?: number | null;
  changeLabel?: React.ReactNode;
  positiveIsGood?: boolean;
  className?: string;
  size?: "md" | "lg";
}) {
  const good = change === null || change === undefined ? null : change === 0 ? null : (change > 0) === positiveIsGood;
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("tabular mt-1 truncate font-semibold tracking-tight text-foreground", size === "lg" ? "text-3xl" : "text-xl")}>{value}</p>
      {changeLabel !== undefined || hint ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {changeLabel !== undefined && change !== null && change !== undefined ? (
            <span className={cn("inline-flex items-center gap-0.5 font-medium", good === null ? "text-muted-foreground" : good ? "text-positive" : "text-negative")}>
              {change > 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : change < 0 ? <ArrowDownRight className="size-3.5" aria-hidden /> : null}
              {changeLabel}
            </span>
          ) : null}
          {hint ? <span>{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
