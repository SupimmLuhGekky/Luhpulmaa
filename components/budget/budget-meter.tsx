import { cn } from "@/lib/utils";

const fills = { on_track: "bg-primary", warning: "bg-warning", over: "bg-danger" } as const;

/**
 * Spending meter for a budget line: share of the available amount used, with a
 * small gap marking each alert threshold below 100%.
 */
export function BudgetMeter({ usedBps, thresholds, status, label, valueText, className }: {
  usedBps: number;
  thresholds: number[];
  status: keyof typeof fills;
  label: string;
  valueText: string;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, usedBps / 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", fills[status])} style={{ width: `${percent}%` }} />
      {thresholds
        .filter((t) => t > 0 && t < 100)
        .map((t) => (
          <span key={t} aria-hidden className="absolute inset-y-0 w-0.5 bg-card" style={{ left: `calc(${t}% - 1px)` }} />
        ))}
    </div>
  );
}
