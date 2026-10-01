"use client";

import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFormat } from "@/components/providers/format-provider";
import type { BudgetView } from "@/lib/budget/service";
import { cn } from "@/lib/utils";

/**
 * Zero-based view: income minus everything budgeted = left to assign.
 * `prominent` renders it as the page's lead card (zero-based budgets).
 */
export function LeftToAssign({ view, prominent, onSetIncome, onAddLine }: { view: BudgetView; prominent?: boolean; onSetIncome: () => void; onAddLine: () => void }) {
  const fmt = useFormat();
  const { income, allocated, unallocated, state } = view.zeroBased;
  const incomeLabel = view.income.planned ? "planned income" : "income received so far";

  if (income <= 0) {
    return (
      <Card className={cn("p-5", prominent && "sm:p-6")}>
        <p className="text-[13px] font-medium text-muted-foreground">Left to assign</p>
        <p className="mt-1 text-sm text-foreground">Set a planned income to see how much of it your lines use.</p>
        <p className="mt-1 text-xs text-muted-foreground">No income has arrived in this period yet, so there&apos;s nothing to assign.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onSetIncome}>
          Set planned income
        </Button>
      </Card>
    );
  }

  const over = state === "over_allocated";
  const budgetedPercent = Math.min(100, (allocated / income) * 100);
  const badge =
    state === "fully_allocated" ? (
      <Badge variant="positive">
        <CheckCircle2 aria-hidden /> Every dollar assigned
      </Badge>
    ) : over ? (
      <Badge variant="danger">
        <AlertTriangle aria-hidden /> Over-assigned
      </Badge>
    ) : (
      <Badge variant="primary">
        <CircleDashed aria-hidden /> Still to assign
      </Badge>
    );

  return (
    <Card className={cn("p-5", prominent && "sm:p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{over ? "Over-assigned by" : "Left to assign"}</p>
        {badge}
      </div>
      <p className={cn("mt-1 font-semibold tracking-tight", prominent ? "text-3xl" : "text-2xl", over ? "text-danger" : "text-foreground")}>{fmt.money(Math.abs(unallocated))}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        <span className="tabular">{fmt.money(income)}</span> {incomeLabel} − <span className="tabular">{fmt.money(allocated)}</span> budgeted
      </p>
      <div
        className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={over ? `Budgeted ${fmt.money(allocated)}, which is ${fmt.money(-unallocated)} more than income` : `Budgeted ${fmt.money(allocated)} of ${fmt.money(income)}; ${fmt.money(unallocated)} left to assign`}
      >
        {over ? (
          <div className="h-full w-full rounded-full bg-danger" />
        ) : (
          <>
            {allocated > 0 ? <div className="h-full rounded-l-full bg-primary last:rounded-r-full" style={{ width: `${budgetedPercent}%` }} /> : null}
            {unallocated > 0 ? <div className="h-full flex-1 rounded-r-full bg-muted first:rounded-l-full" /> : null}
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", over ? "bg-danger" : "bg-primary")} aria-hidden /> Budgeted
        </span>
        {!over ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden /> Not assigned yet
          </span>
        ) : null}
      </div>
      {state === "under_allocated" && prominent ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onAddLine}>
          Give it a job
        </Button>
      ) : null}
      {over ? <p className="mt-3 text-xs text-muted-foreground">Lower a line or raise the planned income so the plan fits.</p> : null}
    </Card>
  );
}
