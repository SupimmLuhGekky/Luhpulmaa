import { cn } from "@/lib/utils";
import { ACTUAL_COLOR, PLANNED_FILL } from "./kind";

/**
 * Two-segment progress toward a target: actual money first (solid), planned money
 * after it (hatched), the rest of the track empty. A 2px surface gap separates the
 * segments; the bar scales to the total when a goal is over-funded.
 */
export function GoalProgressBar({ actual, planned, target, label, valueText, size = "md", className }: {
  actual: number;
  planned: number;
  target: number;
  label: string;
  valueText: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const a = Math.max(0, actual);
  const p = Math.max(0, planned);
  const base = Math.max(target, a + p, 1);
  const pct = (v: number) => (v <= 0 ? 0 : Math.max(0.75, (v * 100) / base));
  const aw = pct(a);
  const pw = pct(p);
  const progress = target > 0 ? Math.min(100, Math.floor(((a + p) * 100) / target)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-valuetext={valueText}
      className={cn("flex w-full overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2", className)}
    >
      {aw > 0 ? <div className={cn("h-full shrink-0", pw > 0 ? "border-r-2 border-card" : "rounded-r-full")} style={{ width: `${aw}%`, backgroundColor: ACTUAL_COLOR }} /> : null}
      {pw > 0 ? <div className="h-full shrink-0 rounded-r-full" style={{ width: `${pw}%`, backgroundImage: PLANNED_FILL }} /> : null}
    </div>
  );
}
