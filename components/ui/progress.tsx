import { cn } from "@/lib/utils";

export interface ProgressProps {
  /** 0–100 (values above 100 are drawn full). */
  value: number;
  label: string;
  tone?: "primary" | "positive" | "warning" | "danger" | "info";
  size?: "sm" | "md";
  className?: string;
  color?: string;
}

const tones = { primary: "bg-primary", positive: "bg-positive", warning: "bg-warning", danger: "bg-danger", info: "bg-info" } as const;

/** Accessible progress bar (role=progressbar with aria values). */
export function Progress({ value, label, tone = "primary", size = "md", className, color }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("w-full overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1.5" : "h-2", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", color ? undefined : tones[tone])} style={{ width: `${clamped}%`, ...(color ? { backgroundColor: color } : {}) }} />
    </div>
  );
}
