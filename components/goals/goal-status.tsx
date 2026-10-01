import { AlertTriangle, Archive, CircleCheck, Clock, Flag, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GoalListItem } from "@/lib/goals/service";

/** One status badge per goal (icon + label, never colour alone). */
export function GoalStatusBadge({ goal }: { goal: GoalListItem }) {
  if (goal.status === "COMPLETED")
    return (
      <Badge variant="positive">
        <CircleCheck aria-hidden /> {goal.progress.isComplete ? "Reached" : "Completed"}
      </Badge>
    );
  if (goal.status === "ARCHIVED")
    return (
      <Badge>
        <Archive aria-hidden /> Archived
      </Badge>
    );
  if (goal.progress.isOverdue)
    return (
      <Badge variant="danger">
        <AlertTriangle aria-hidden /> Overdue
      </Badge>
    );
  if (goal.pace.onTrack === true)
    return (
      <Badge variant="positive">
        <TrendingUp aria-hidden /> On track
      </Badge>
    );
  if (goal.pace.onTrack === false)
    return (
      <Badge variant="warning">
        <Clock aria-hidden /> Behind
      </Badge>
    );
  return null;
}

const PRIORITY = { HIGH: "High priority", MEDIUM: "Medium priority", LOW: "Low priority" } as const;

export function PriorityBadge({ priority }: { priority: GoalListItem["priority"] }) {
  return (
    <Badge variant="outline">
      <Flag aria-hidden /> {PRIORITY[priority]}
    </Badge>
  );
}

/** "3 days", "5 weeks", "8 months" — rounded, for "… left" copy. */
export function humanDuration(days: number): string {
  if (days <= 1) return days === 1 ? "1 day" : "less than a day";
  if (days < 14) return `${days} days`;
  if (days < 70) return `${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.44);
  return `${months} months`;
}

/** Deadline line for a goal: "By Jun 1, 2027 · 8 months left", "Was due Sep 1, 2026", "Reached Aug 3, 2026"… */
export function deadlineText(goal: GoalListItem, date: (d: string) => string): string {
  if (goal.status === "COMPLETED") return goal.completedOn ? `${goal.progress.isComplete ? "Reached" : "Completed"} ${date(goal.completedOn)}` : "Completed";
  if (!goal.deadline) return "No deadline";
  const days = goal.progress.daysLeft ?? 0;
  if (goal.progress.isOverdue) return `Was due ${date(goal.deadline)}`;
  if (days === 0) return `Due today`;
  return `By ${date(goal.deadline)} · ${humanDuration(days)} left`;
}
