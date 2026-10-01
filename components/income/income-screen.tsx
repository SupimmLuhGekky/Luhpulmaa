"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CalendarDays, HandCoins, Landmark, ListChecks, MoreHorizontal, Pencil, Plus, Radar, Star, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { useFormat } from "@/components/providers/format-provider";
import { deleteAllocationPlanAction, deleteIncomeSourceAction, setPrimaryIncomeSourceAction } from "@/app/actions/income";
import { daysBetween } from "@/lib/dates";
import { monthlyEquivalent } from "@/lib/finance/frequency";
import type { GoalAccountOption } from "@/lib/goals/service";
import { previewAllocation } from "@/lib/income/allocation";
import type { ExpectedPayday } from "@/lib/income/schedule";
import { cn } from "@/lib/utils";
import { AllocationPreviewView, type Destinations } from "./allocation-preview";
import { ApplyPlanDialog } from "./apply-plan-dialog";
import { IncomeSourceDialog, type IncomeSourceFormValue } from "./income-source-dialog";
import { scheduleLabel } from "./labels";
import { PlanDialog, type PlanFormValue, type PlanOptions } from "./plan-dialog";

export interface IncomeSourceView extends IncomeSourceFormValue {
  isPrimary: boolean;
  lastPaidDate: string | null;
  estimate: { perPaycheck: number; monthly: number; yearly: number; nextPayday: string | null };
}

export interface IncomeScreenProps {
  sources: IncomeSourceView[];
  totals: { monthly: number; yearly: number; nextPayday: string | null };
  paydays: ExpectedPayday[];
  /** Days covered by `paydays`, from today. */
  horizonDays: number;
  plans: PlanFormValue[];
  goals: { id: string; name: string; archived: boolean }[];
  categories: { id: string; name: string }[];
  accounts: GoalAccountOption[];
}

export function IncomeScreen({ sources, totals, paydays, horizonDays, plans, goals, categories, accounts }: IncomeScreenProps) {
  const router = useRouter();
  const fmt = useFormat();
  const [sourceDialog, setSourceDialog] = React.useState<{ open: boolean; source: IncomeSourceView | null }>({ open: false, source: null });
  const [deletingSource, setDeletingSource] = React.useState<IncomeSourceView | null>(null);
  const [planDialog, setPlanDialog] = React.useState<{ open: boolean; plan: PlanFormValue | null; template: "50-30-20" | null }>({ open: false, plan: null, template: null });
  const [applying, setApplying] = React.useState<PlanFormValue | null>(null);
  const [deletingPlan, setDeletingPlan] = React.useState<PlanFormValue | null>(null);

  const destinations: Destinations = React.useMemo(
    () => ({ goals: Object.fromEntries(goals.map((g) => [g.id, g.archived ? `${g.name} (archived)` : g.name])), categories: Object.fromEntries(categories.map((c) => [c.id, c.name])) }),
    [goals, categories],
  );
  const planOptions = (plan: PlanFormValue | null): PlanOptions => {
    const used = new Set(plan?.items.map((i) => i.goal?.id).filter(Boolean));
    return {
      sources: sources.map((s) => ({ id: s.id, name: s.name, averageAmountCents: s.averageAmountCents })),
      goals: goals.filter((g) => !g.archived || used.has(g.id)).map((g) => ({ id: g.id, name: g.archived ? `${g.name} (archived)` : g.name })),
      categories,
    };
  };

  const next = paydays[0] ?? null;
  const nextIn = next ? daysBetween(fmt.today, next.date) : null;
  const primary = sources.find((s) => s.isPrimary) ?? sources[0];
  // Default payday for applying a plan: the last one that has happened for the plan's source, else today.
  const lastPayday = (plan: PlanFormValue) => {
    const s = sources.find((x) => x.id === plan.incomeSource?.id) ?? primary;
    return s?.lastPaidDate && s.lastPaidDate <= fmt.today && daysBetween(s.lastPaidDate, fmt.today) <= 16 ? s.lastPaidDate : fmt.today;
  };

  return (
    <>
      <PageHeader
        title="Income"
        description="Your paydays, and a plan for every paycheque."
        actions={
          sources.length ? (
            <Button size="sm" onClick={() => setSourceDialog({ open: true, source: null })}>
              <Plus /> Add income
            </Button>
          ) : undefined
        }
      />

      {sources.length ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
          <Card className="col-span-2 p-4 sm:p-5 xl:col-span-1">
            <Stat
              label="Next payday"
              value={next ? fmt.date(next.date, "weekdayShort") : "—"}
              hint={next ? `${nextIn === 0 ? "Today" : nextIn === 1 ? "Tomorrow" : `In ${nextIn} days`} · ${next.name} · ≈ ${fmt.money(next.amount)} (estimate)` : "No payday expected soon"}
            />
          </Card>
          <Card className="p-4 sm:p-5">
            <Stat label="Monthly income" value={fmt.money(totals.monthly)} hint={`Estimate from ${sources.length} source${sources.length === 1 ? "" : "s"}`} />
          </Card>
          <Card className="p-4 sm:p-5">
            <Stat label="Yearly income" value={fmt.money(totals.yearly)} hint="Estimate, after tax" />
          </Card>
        </div>
      ) : null}

      <div className={cn("grid gap-4 lg:grid-cols-3 lg:items-start", sources.length && "mt-4")}>
        <Card className="min-w-0 lg:col-span-2">
          <CardHeading title="Income sources" description="Detected from your deposits or added by you. Amounts are averages." />
          {sources.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {sources.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  onEdit={() => setSourceDialog({ open: true, source: s })}
                  onDelete={() => setDeletingSource(s)}
                  onMakePrimary={async () => {
                    const res = await setPrimaryIncomeSourceAction({ id: s.id });
                    if (!res.ok) return void toast.error(res.error.message);
                    toast.success("Primary income updated", { description: s.name });
                    router.refresh();
                  }}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Wallet}
              title="Add your paycheque"
              description="Harbour spots paydays from your deposits once an account is connected. You can also add income yourself."
              action={
                <Button onClick={() => setSourceDialog({ open: true, source: null })}>
                  <Plus /> Add income
                </Button>
              }
            />
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeading title="Upcoming paydays" description={`Next ${horizonDays} days. Dates and amounts are estimates.`} />
          {paydays.length ? (
            <ol className="divide-y divide-border border-t border-border">
              {paydays.slice(0, 8).map((p) => {
                const d = daysBetween(fmt.today, p.date);
                return (
                  <li key={`${p.sourceId}-${p.date}`} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-lg bg-subtle text-center leading-none">
                      <span className="text-[10px] font-medium uppercase text-muted-foreground">{fmt.date(p.date, "month")}</span>
                      <span className="tabular text-sm font-semibold text-foreground">{Number(p.date.slice(8, 10))}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`}</p>
                    </div>
                    <p className="tabular shrink-0 text-sm font-medium text-foreground">≈ {fmt.money(p.amount)}</p>
                  </li>
                );
              })}
              {paydays.length > 8 ? <li className="px-5 py-2.5 text-xs text-muted-foreground">{paydays.length - 8} more in the next {horizonDays} days</li> : null}
            </ol>
          ) : (
            <EmptyState compact icon={CalendarDays} title="No paydays expected" description={sources.length ? `Nothing is due in the next ${horizonDays} days.` : "Add income to see your paydays."} />
          )}
        </Card>
      </div>

      <Card className="mt-4 min-w-0">
        <CardHeading title="Paycheque plans" description="Split each paycheque into goals and spending. Applying a plan records planned allocations for your goals — it never moves money." />
        {plans.length ? (
          <div className="grid gap-4 border-t border-border p-4 sm:p-5 md:grid-cols-2">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                destinations={destinations}
                onApply={() => setApplying(plan)}
                onEdit={() => setPlanDialog({ open: true, plan, template: null })}
                onDelete={() => setDeletingPlan(plan)}
                fallbackIncome={primary?.averageAmountCents ?? 0}
              />
            ))}
            <button
              type="button"
              onClick={() => setPlanDialog({ open: true, plan: null, template: null })}
              className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-4 text-center transition-colors hover:border-primary/50 hover:bg-subtle"
            >
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Plus className="size-4" aria-hidden /> New plan
              </span>
              <span className="text-xs text-muted-foreground">For another income, or a different split</span>
            </button>
          </div>
        ) : (
          <EmptyState
            icon={ListChecks}
            title="Give every paycheque a plan"
            description="For example 50% to needs, 30% to wants and 20% to a goal. When you're paid, apply the plan to earmark the goal amounts."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setPlanDialog({ open: true, plan: null, template: "50-30-20" })}>
                  <Plus /> Start from 50/30/20
                </Button>
                <Button variant="outline" onClick={() => setPlanDialog({ open: true, plan: null, template: null })}>
                  Blank plan
                </Button>
              </div>
            }
          />
        )}
      </Card>

      <IncomeSourceDialog open={sourceDialog.open} onOpenChange={(open) => setSourceDialog((s) => ({ ...s, open }))} source={sourceDialog.source} accounts={accounts} />
      <PlanDialog open={planDialog.open} onOpenChange={(open) => setPlanDialog((s) => ({ ...s, open }))} plan={planDialog.plan} options={planOptions(planDialog.plan)} template={planDialog.template} />
      <ApplyPlanDialog open={applying !== null} onOpenChange={(open) => !open && setApplying(null)} plan={applying} destinations={destinations} defaultDate={applying ? lastPayday(applying) : fmt.today} />
      <ConfirmDialog
        open={deletingSource !== null}
        onOpenChange={(open) => !open && setDeletingSource(null)}
        title={`Delete ${deletingSource?.name ?? "this income"}?`}
        description={
          deletingSource?.matchPattern
            ? "Its paydays leave your forecast. Harbour found this income in your deposits, so it may detect it again after the next sync."
            : "Its paydays leave your forecast and safe-to-spend. Past transactions aren't affected."
        }
        confirmLabel="Delete income"
        destructive
        onConfirm={async () => {
          if (!deletingSource) return;
          const res = await deleteIncomeSourceAction({ id: deletingSource.id });
          if (!res.ok) return void toast.error(res.error.message);
          toast.success("Income deleted", { description: deletingSource.name });
          setDeletingSource(null);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={deletingPlan !== null}
        onOpenChange={(open) => !open && setDeletingPlan(null)}
        title={`Delete the ${deletingPlan?.name ?? ""} plan?`}
        description="Planned allocations it already recorded stay on your goals; you can remove them from each goal's history."
        confirmLabel="Delete plan"
        destructive
        onConfirm={async () => {
          if (!deletingPlan) return;
          const res = await deleteAllocationPlanAction({ id: deletingPlan.id });
          if (!res.ok) return void toast.error(res.error.message);
          toast.success("Plan deleted", { description: deletingPlan.name });
          setDeletingPlan(null);
          router.refresh();
        }}
      />
    </>
  );
}

function SourceRow({ source: s, onEdit, onDelete, onMakePrimary }: { source: IncomeSourceView; onEdit: () => void; onDelete: () => void; onMakePrimary: () => void }) {
  const fmt = useFormat();
  const next = s.estimate.nextPayday;
  const nextIn = next ? daysBetween(fmt.today, next) : null;
  return (
    <li className="flex items-start gap-3 px-4 py-4 sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-positive-soft text-positive [&_svg]:size-4" aria-hidden>
        <HandCoins />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
          {s.isPrimary ? (
            <Badge variant="primary">
              <Star aria-hidden /> Primary
            </Badge>
          ) : null}
          {s.isDetected ? (
            <Badge variant="info">
              <Radar aria-hidden /> Detected
            </Badge>
          ) : s.matchPattern ? (
            <Badge variant="outline">
              <BadgeCheck aria-hidden /> Matched to deposits
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{scheduleLabel(s.frequency, s.semiMonthlyDays)}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Average pay</dt>
            <dd className="tabular font-medium text-foreground">{fmt.money(s.averageAmountCents)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Next payday</dt>
            <dd className="font-medium text-foreground">{next ? `${fmt.date(next, "monthDay")}${nextIn !== null && nextIn <= 7 ? ` · ${nextIn === 0 ? "today" : nextIn === 1 ? "tomorrow" : `in ${nextIn} days`}` : ""}` : "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Last paid</dt>
            <dd className="text-foreground">{s.lastPaidDate ? fmt.date(s.lastPaidDate, "monthDay") : "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Per month</dt>
            <dd className="tabular text-foreground">≈ {fmt.money(monthlyEquivalent(s.averageAmountCents, s.frequency as "WEEKLY"))}</dd>
          </div>
        </dl>
        {s.account ? (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Landmark className="size-3" aria-hidden /> Deposited to {s.account.name}
          </p>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" aria-label={`Actions for ${s.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil /> Edit income
          </DropdownMenuItem>
          {!s.isPrimary ? (
            <DropdownMenuItem onSelect={onMakePrimary}>
              <Star /> Make primary
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={onDelete}>
            <Trash2 /> Delete income
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function PlanCard({ plan, destinations, onApply, onEdit, onDelete, fallbackIncome }: { plan: PlanFormValue; destinations: Destinations; onApply: () => void; onEdit: () => void; onDelete: () => void; fallbackIncome: number }) {
  const fmt = useFormat();
  const headingId = React.useId();
  const income = plan.incomeSource?.averageAmountCents ?? fallbackIncome;
  const preview = previewAllocation(
    income,
    plan.items.map((i) => ({ label: i.label, method: i.method, percentBps: i.percentBps, amountCents: i.amountCents, goalId: i.goal?.id ?? null, categoryId: i.category?.id ?? null })),
  );
  return (
    <article aria-labelledby={headingId} className="flex min-w-0 flex-col rounded-xl border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="truncate text-sm font-semibold text-foreground">
            {plan.name}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {plan.incomeSource ? `${plan.incomeSource.name} · ` : "Any paycheque · "}
            {plan.items.length} line{plan.items.length === 1 ? "" : "s"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" aria-label={`Actions for ${plan.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit plan
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2 /> Delete plan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{income > 0 ? `On a ${fmt.money(income)} paycheque (estimate):` : "Add income to preview this plan."}</p>
      <AllocationPreviewView className="mt-2 flex-1" preview={preview} income={income} destinations={destinations} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onApply}>
          Apply to a paycheque
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </article>
  );
}
