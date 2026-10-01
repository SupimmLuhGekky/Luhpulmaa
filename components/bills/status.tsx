import { AlertCircle, Check, Clock, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OccurrenceStatus } from "@/lib/bills/calendar";
import { cn } from "@/lib/utils";

/** Status presentation: always icon + label, colour only reinforces it. */
export const STATUS_META: Record<OccurrenceStatus, { label: string; icon: LucideIcon | null; badge: "positive" | "danger" | "warning" | "neutral"; chip: string; dot: string }> = {
  paid: { label: "Paid", icon: Check, badge: "positive", chip: "bg-positive-soft text-positive", dot: "bg-positive" },
  overdue: { label: "Overdue", icon: AlertCircle, badge: "danger", chip: "bg-danger-soft text-danger", dot: "bg-danger" },
  "due-today": { label: "Due today", icon: Clock, badge: "warning", chip: "bg-warning-soft text-warning", dot: "bg-warning" },
  upcoming: { label: "Upcoming", icon: null, badge: "neutral", chip: "bg-muted text-foreground", dot: "bg-muted-foreground/60" },
};

export function StatusBadge({ status, className }: { status: OccurrenceStatus; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant={meta.badge} className={cn(className)}>
      {Icon ? <Icon aria-hidden /> : null}
      {meta.label}
    </Badge>
  );
}

export const REMINDER_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "No reminder" },
  { value: "0", label: "On the due date" },
  { value: "1", label: "1 day before" },
  { value: "2", label: "2 days before" },
  { value: "3", label: "3 days before" },
  { value: "5", label: "5 days before" },
  { value: "7", label: "7 days before" },
  { value: "14", label: "14 days before" },
];

export function reminderLabel(days: number | null | undefined) {
  if (days === null || days === undefined) return "No reminder";
  if (days === 0) return "On the due date";
  return `${days} day${days === 1 ? "" : "s"} before`;
}

/** Reminder option value for a stored setting (custom values are added to the list by the forms). */
export function reminderValue(days: number | null | undefined) {
  return days === null || days === undefined ? "none" : String(days);
}
