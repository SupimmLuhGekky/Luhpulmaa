"use client";

import { AlertTriangle } from "lucide-react";
import { useFormat } from "@/components/providers/format-provider";
import { PLANNED_FILL } from "@/components/goals/kind";
import { formatBps } from "@/lib/finance/money";
import type { AllocationPreview } from "@/lib/income/allocation";
import { cn } from "@/lib/utils";

/** Goal lines become planned allocations (hatched, as on the goals pages); everything else is spending. */
const SPENDING_COLOR = "var(--chart-2)";

export interface Destinations {
  goals: Record<string, string>;
  categories: Record<string, string>;
}

function Swatch({ goal, className }: { goal: boolean; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", className)} style={goal ? { backgroundImage: PLANNED_FILL } : { backgroundColor: SPENDING_COLOR }} />;
}

/**
 * A paycheque split: one bar segment per line (2px gaps), totals for goals vs spending,
 * and the lines with what each receives. Shows when lines had to be scaled down.
 */
export function AllocationPreviewView({ preview, income, destinations, compact = false, className }: { preview: AllocationPreview; income: number; destinations: Destinations; compact?: boolean; className?: string }) {
  const fmt = useFormat();
  const toGoals = preview.lines.reduce((a, l) => a + (l.goalId ? l.amount : 0), 0);
  const toSpending = preview.lines.reduce((a, l) => a + (l.goalId ? 0 : l.amount), 0);
  const base = Math.max(income, 1);
  const segments = preview.lines.filter((l) => l.amount > 0);

  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="img"
        aria-label={`${fmt.money(income)} paycheque: ${fmt.money(toGoals)} to goals as planned money, ${fmt.money(toSpending)} to spending, ${fmt.money(preview.unallocated)} left over`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
      >
        {segments.map((l, i) => (
          <div
            key={i}
            className={cn("h-full shrink-0", i < segments.length - 1 || preview.unallocated > 0 ? "border-r-2 border-card" : "")}
            style={{ width: `${Math.max(0.75, (l.amount * 100) / base)}%`, ...(l.goalId ? { backgroundImage: PLANNED_FILL } : { backgroundColor: SPENDING_COLOR }) }}
          />
        ))}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div className="inline-flex items-center gap-1.5">
          <Swatch goal />
          <dt className="text-muted-foreground">To goals (planned)</dt>
          <dd className="tabular font-medium text-foreground">{fmt.money(toGoals)}</dd>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <Swatch goal={false} />
          <dt className="text-muted-foreground">Spending</dt>
          <dd className="tabular font-medium text-foreground">{fmt.money(toSpending)}</dd>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[3px] border border-border bg-muted" />
          <dt className="text-muted-foreground">Left over</dt>
          <dd className="tabular font-medium text-foreground">{fmt.money(preview.unallocated)}</dd>
        </div>
      </dl>

      {preview.overAllocated ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {preview.totalPercentBps > 10000 ? `Percentages add up to ${formatBps(preview.totalPercentBps, 0, fmt.locale)}. ` : ""}
            This plan asks for {fmt.money(preview.shortfall)} more than the paycheque, so {preview.totalPercentBps > 0 ? "percentage lines are scaled down" : "the last fixed lines get less"}.
          </span>
        </p>
      ) : null}

      {!compact ? (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {preview.lines.map((l, i) => {
            const dest = l.goalId ? destinations.goals[l.goalId] : l.categoryId ? destinations.categories[l.categoryId] : null;
            // Don't repeat the destination when the line is already named after it.
            const named = dest !== undefined && dest !== null && dest.trim().toLowerCase() === l.label.trim().toLowerCase();
            const where = l.goalId ? `to ${named || !dest ? "goal" : dest} (planned)` : dest && !named ? dest : null;
            const short = l.requested - l.amount;
            return (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <Swatch goal={Boolean(l.goalId)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-foreground">{l.label || "Untitled line"}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.method === "PERCENT" ? `${formatBps(l.percentBps ?? 0, (l.percentBps ?? 0) % 100 ? 2 : 0, fmt.locale)} of pay` : "Fixed"}
                    {where ? ` · ${where}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-[13px] font-medium text-foreground">{fmt.money(l.amount)}</p>
                  {short > 0 ? <p className="tabular text-xs text-warning">{fmt.money(short)} short</p> : null}
                </div>
              </li>
            );
          })}
          <li className="flex items-center gap-3 px-3 py-2">
            <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[3px] border border-border bg-muted" />
            <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">Left over</p>
            <p className="tabular text-[13px] font-medium text-foreground">{fmt.money(preview.unallocated)}</p>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
