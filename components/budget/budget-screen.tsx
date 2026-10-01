"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, ChevronLeft, ChevronRight, MoreHorizontal, PiggyBank, Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { useFormat } from "@/components/providers/format-provider";
import { deleteBudgetAction, deleteBudgetLineAction } from "@/app/actions/budget";
import { daysBetween, monthKey, startOfMonth, startOfWeek, type LocalDate } from "@/lib/dates";
import { budgetHref, periodLabel, periodTiming, shiftPeriod, type BudgetPeriodName } from "@/lib/budget/periods";
import type { BudgetHistoryPoint, BudgetLineView, BudgetSummary, BudgetView } from "@/lib/budget/service";
import { cn } from "@/lib/utils";
import { BudgetLineDialog } from "./budget-line-dialog";
import { BudgetLines } from "./budget-lines";
import { BudgetSettingsDialog } from "./budget-settings-dialog";
import { CreateBudgetDialog } from "./create-budget-dialog";
import { LeftToAssign } from "./left-to-assign";
import { PlanVsActual } from "./plan-vs-actual";
import { UnbudgetedCard } from "./unbudgeted-card";

export interface BudgetScreenProps {
  selection: { period: BudgetPeriodName; start: LocalDate | null; end: LocalDate | null; id: string | null };
  view: BudgetView | null;
  history: BudgetHistoryPoint[];
  budgets: BudgetSummary[];
  defaults: { mode: "STANDARD" | "ZERO_BASED"; weekStartsOn: number; monthlyIncomeTargetCents: number | null; alertThresholds: number[]; rolloverEnabled: boolean };
  openNew: boolean;
}

type LineDialogState = { open: boolean; line: BudgetLineView | null; preset: { categoryId: string | null; amountCents: number | null } | null };

const UNIT = { MONTHLY: "month", WEEKLY: "week", CUSTOM: "budget" } as const;

export function BudgetScreen({ selection, view, history, budgets, defaults, openNew }: BudgetScreenProps) {
  const router = useRouter();
  const fmt = useFormat();
  const { period } = selection;
  const start = view?.budget.start ?? selection.start;
  const end = view?.budget.end ?? selection.end;
  const label = start && end ? periodLabel(period, start, end, fmt.locale) : "Custom budgets";
  const timing = start && end ? periodTiming(start, end, fmt.today) : "current";

  const [createOpen, setCreateOpen] = React.useState(openNew);
  const [createInitial, setCreateInitial] = React.useState<{ period: BudgetPeriodName; start: LocalDate | null }>(() => suggestCreate(selection, view, budgets, defaults.weekStartsOn, fmt.today));
  const [lineDialog, setLineDialog] = React.useState<LineDialogState>({ open: false, line: null, preset: null });
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [deletingLine, setDeletingLine] = React.useState<BudgetLineView | null>(null);
  const [deletingBudget, setDeletingBudget] = React.useState(false);

  // "New → Budget" in the header links to /budget?new=1, also while this page is open.
  React.useEffect(() => {
    if (openNew) {
      setCreateInitial(suggestCreate(selection, view, budgets, defaults.weekStartsOn, fmt.today));
      setCreateOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the flag itself
  }, [openNew]);

  // Closing drops ?new=1 so Back doesn't reopen the dialog. One navigation per outcome:
  // a cancel returns to the period on screen, a create goes to the new budget.
  const closeCreate = (open: boolean) => {
    setCreateOpen(open);
    if (!open && openNew) router.replace(budgetHref({ period, start: selection.start, id: selection.id }), { scroll: false });
  };
  const finishCreate = (href: string) => {
    setCreateOpen(false);
    if (openNew) router.replace(href);
    else router.push(href);
  };
  const openCreate = (initial: { period: BudgetPeriodName; start: LocalDate | null }) => {
    setCreateInitial(initial);
    setCreateOpen(true);
  };

  const switchPeriod = (p: BudgetPeriodName) => {
    if (p === period) return;
    router.push(budgetHref({ period: p, start: p === "MONTHLY" ? startOfMonth(fmt.today) : p === "WEEKLY" ? startOfWeek(fmt.today, defaults.weekStartsOn) : null }));
  };

  const customBudgets = budgets.filter((b) => b.period === "CUSTOM");
  const createDialog = (
    <CreateBudgetDialog
      open={createOpen}
      onOpenChange={closeCreate}
      onCreated={finishCreate}
      budgets={budgets}
      weekStartsOn={defaults.weekStartsOn}
      defaultMode={defaults.mode}
      monthlyIncomeTargetCents={defaults.monthlyIncomeTargetCents}
      initial={createInitial}
    />
  );

  const header = (
    <PageHeader
      title="Budget"
      description="Plan where your money goes, then see how it's going."
      actions={
        <>
          <Segmented
            size="sm"
            aria-label="Budget period"
            value={period}
            onChange={switchPeriod}
            options={[
              { value: "MONTHLY", label: "Monthly" },
              { value: "WEEKLY", label: "Weekly" },
              { value: "CUSTOM", label: "Custom" },
            ]}
          />
          <Button size="sm" onClick={() => openCreate(suggestCreate(selection, view, budgets, defaults.weekStartsOn, fmt.today))}>
            <Plus /> New budget
          </Button>
        </>
      }
    />
  );

  const nav =
    period === "CUSTOM" ? (
      <div className="flex flex-wrap items-center gap-2">
        {customBudgets.length > 1 ? (
          <Select
            aria-label="Custom budget"
            className="w-64 max-w-full"
            value={view?.budget.id ?? ""}
            onChange={(e) => router.push(budgetHref({ period: "CUSTOM", id: e.target.value }))}
            options={customBudgets.map((b) => ({ value: b.id, label: `${b.name} · ${periodLabel("CUSTOM", b.startDate, b.endDate, fmt.locale)}` }))}
          />
        ) : null}
        {view ? <h2 className="text-base font-semibold tracking-tight">{customBudgets.length > 1 ? label : `${view.budget.name} · ${label}`}</h2> : null}
      </div>
    ) : start ? (
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" asChild>
          <Link href={budgetHref({ period, start: shiftPeriod(period, start, -1, defaults.weekStartsOn).start })} aria-label={`Previous ${UNIT[period]}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <h2 className="min-w-0 px-2 text-center text-base font-semibold tracking-tight sm:min-w-44" aria-live="polite">
          {label}
        </h2>
        <Button variant="outline" size="icon-sm" asChild>
          <Link href={budgetHref({ period, start: shiftPeriod(period, start, 1, defaults.weekStartsOn).start })} aria-label={`Next ${UNIT[period]}`}>
            <ChevronRight />
          </Link>
        </Button>
        {timing !== "current" ? (
          <Button variant="ghost" size="sm" asChild className="ml-1">
            <Link href={budgetHref({ period, start: period === "MONTHLY" ? `${monthKey(fmt.today)}-01` : startOfWeek(fmt.today, defaults.weekStartsOn) })}>{period === "MONTHLY" ? "This month" : "This week"}</Link>
          </Button>
        ) : null}
      </div>
    ) : null;

  const timingBadge =
    start && end ? (
      timing === "current" ? (
        <Badge variant="primary">{daysBetween(fmt.today, end) + 1 === 1 ? "Last day" : `${daysBetween(fmt.today, end) + 1} days left`}</Badge>
      ) : timing === "past" ? (
        <Badge>Ended</Badge>
      ) : (
        <Badge variant="info">Upcoming</Badge>
      )
    ) : null;

  if (!view) {
    const previous = start ? budgets.find((b) => b.period === period && b.startDate < start) : undefined;
    return (
      <>
        {header}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          {nav}
          {timingBadge}
        </div>
        <Card>
          {period === "CUSTOM" ? (
            <EmptyState
              icon={CalendarRange}
              title="No custom budgets yet"
              description="Plan any stretch of days — a trip, the holidays, a moving month — with its own lines."
              action={
                <Button onClick={() => openCreate({ period: "CUSTOM", start: null })}>
                  <Plus /> Create a custom budget
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={PiggyBank}
              title={`No budget for ${period === "MONTHLY" ? label : label.replace("Week of", "the week of")}`}
              description={
                previous
                  ? `Start from your ${periodLabel(previous.period, previous.startDate, previous.endDate, fmt.locale)} plan (${previous.lineCount} line${previous.lineCount === 1 ? "" : "s"}) and adjust, or begin with a blank budget.`
                  : "Set how much you want to spend in each category. Harbour compares it with your real spending as transactions arrive."
              }
              action={
                <Button onClick={() => openCreate({ period, start })}>
                  <Plus /> {previous ? `Start from ${periodLabel(previous.period, previous.startDate, previous.endDate, fmt.locale).replace("Week of", "the week of")}` : "Create a budget"}
                </Button>
              }
            />
          )}
        </Card>
        {createDialog}
      </>
    );
  }

  const { totals, income, lines } = view;
  const tracked = lines.filter((l) => l.categoryId);
  const daysLeft = end && timing === "current" ? daysBetween(fmt.today, end) + 1 : null;
  const perDay = daysLeft && totals.remaining > 0 ? Math.floor(totals.remaining / daysLeft) : null;
  const usedPercent = totals.available > 0 ? Math.round((totals.spent * 100) / totals.available) : null;
  const zeroBased = view.budget.mode === "ZERO_BASED";
  const range = { start: view.budget.start, end: view.budget.end };
  const incomeIsPlanned = view.income.planned > 0;

  const chart = period !== "CUSTOM" && history.length >= 2 ? <PlanVsActual history={history} period={period} /> : null;
  const leftToAssign = <LeftToAssign view={view} prominent={zeroBased} onSetIncome={() => setSettingsOpen(true)} onAddLine={() => setLineDialog({ open: true, line: null, preset: null })} />;

  return (
    <>
      {header}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {nav}
        <div className="flex items-center gap-2">
          {timingBadge}
          <Badge variant="outline">{zeroBased ? "Zero-based" : "Standard"}</Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Budget options">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings2 /> Budget settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLineDialog({ open: true, line: null, preset: null })}>
                <Plus /> Add a line
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setDeletingBudget(true)}>
                <Trash2 /> Delete budget
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Card className="p-4 sm:p-5">
          <Stat
            label={incomeIsPlanned ? "Planned income" : "Income received"}
            value={fmt.money(incomeIsPlanned ? income.planned : income.actual)}
            hint={incomeIsPlanned ? `${fmt.money(income.actual)} received so far` : "No planned income set"}
          />
        </Card>
        <Card className="p-4 sm:p-5">
          <Stat
            label="Budgeted"
            value={fmt.money(totals.budgeted)}
            hint={[`${lines.length} line${lines.length === 1 ? "" : "s"}`, totals.rollover ? `+${fmt.money(totals.rollover)} rollover` : null, totals.setAside ? `${fmt.money(totals.setAside)} set aside` : null].filter(Boolean).join(" · ")}
          />
        </Card>
        <Card className="p-4 sm:p-5">
          <Stat
            label="Spent"
            value={fmt.money(totals.spent)}
            hint={`${usedPercent !== null ? `${usedPercent}% of the plan` : "in budgeted categories"}${totals.unbudgetedSpent ? ` · +${fmt.money(totals.unbudgetedSpent)} unbudgeted` : ""}`}
          />
        </Card>
        <Card className="p-4 sm:p-5">
          <Stat
            label={totals.remaining < 0 ? "Over budget" : "Left to spend"}
            value={<span className={cn(totals.remaining < 0 && "text-danger")}>{fmt.money(Math.abs(totals.remaining))}</span>}
            hint={
              !tracked.length
                ? "Add lines to plan your spending"
                : daysLeft === 1
                ? `Last day of this ${UNIT[period]}`
                : perDay !== null
                  ? `About ${fmt.money(perDay)} a day for ${daysLeft} days (estimate)`
                  : timing === "past"
                    ? `This ${UNIT[period]} has ended`
                    : timing === "future"
                      ? "Not started yet"
                      : undefined
            }
          />
        </Card>
      </div>

      {zeroBased ? <div className="mt-4">{leftToAssign}</div> : null}

      <Card className="mt-4 min-w-0">
        <CardHeading
          title="Spending plan"
          description={tracked.length ? "Planned vs actual for each line. Alerts notify you as spending climbs." : "Lines you add appear here."}
          action={
            lines.length ? (
              <Button size="sm" variant="outline" onClick={() => setLineDialog({ open: true, line: null, preset: null })}>
                <Plus /> Add line
              </Button>
            ) : null
          }
        />
        <BudgetLines
          lines={lines}
          range={range}
          defaultThresholds={defaults.alertThresholds}
          onAdd={() => setLineDialog({ open: true, line: null, preset: null })}
          onEdit={(line) => setLineDialog({ open: true, line, preset: null })}
          onDelete={setDeletingLine}
        />
      </Card>

      <div className={cn("mt-4 grid gap-4", chart ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {chart ? <div className="min-w-0 lg:col-span-2">{chart}</div> : null}
        <div className={cn("flex min-w-0 flex-col gap-4", !chart && "contents")}>
          {!zeroBased ? leftToAssign : null}
          <UnbudgetedCard
            items={view.unbudgeted}
            total={totals.unbudgetedSpent}
            spentInLines={totals.spent}
            range={range}
            onBudget={(u) => setLineDialog({ open: true, line: null, preset: { categoryId: u.categoryId, amountCents: Math.ceil(u.spent / 1000) * 1000 } })}
          />
        </div>
      </div>

      {view.budget.notes ? (
        <p className="mt-4 rounded-lg border border-border bg-subtle px-4 py-3 text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Notes: </span>
          {view.budget.notes}
        </p>
      ) : null}

      <BudgetLineDialog
        open={lineDialog.open}
        onOpenChange={(open) => setLineDialog((s) => ({ ...s, open }))}
        budgetId={view.budget.id}
        period={period}
        incomeBase={income.base}
        incomeIsPlanned={incomeIsPlanned}
        categories={view.availableCategories}
        line={lineDialog.line}
        preset={lineDialog.preset}
        defaultThresholds={defaults.alertThresholds}
        defaultRollover={defaults.rolloverEnabled}
      />
      <BudgetSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        budget={{ id: view.budget.id, name: view.budget.name, mode: view.budget.mode, plannedIncomeCents: view.budget.plannedIncomeCents, notes: view.budget.notes }}
        actualIncome={income.actual}
      />
      <ConfirmDialog
        open={deletingLine !== null}
        onOpenChange={(open) => !open && setDeletingLine(null)}
        title={`Delete the ${deletingLine?.name ?? ""} line?`}
        description={deletingLine?.categoryId ? "Your transactions stay as they are; this category's spending will show as unbudgeted." : "The money planned for this line becomes unassigned."}
        confirmLabel="Delete line"
        destructive
        onConfirm={async () => {
          if (!deletingLine) return;
          const res = await deleteBudgetLineAction({ itemId: deletingLine.id });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success("Line deleted", { description: deletingLine.name });
          setDeletingLine(null);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={deletingBudget}
        onOpenChange={setDeletingBudget}
        title={`Delete the ${label} budget?`}
        description={`Its ${lines.length} line${lines.length === 1 ? "" : "s"} will be removed. Your transactions and other budgets aren't affected.`}
        confirmLabel="Delete budget"
        destructive
        onConfirm={async () => {
          const res = await deleteBudgetAction({ budgetId: view.budget.id });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success("Budget deleted", { description: label });
          setDeletingBudget(false);
          router.replace(budgetHref({ period, start: period === "CUSTOM" ? null : start }));
          router.refresh();
        }}
      />
      {createDialog}
    </>
  );
}

/** What "New budget" should start with: the period on screen if it has no budget yet, otherwise the next free one. */
function suggestCreate(selection: BudgetScreenProps["selection"], view: BudgetView | null, budgets: BudgetSummary[], weekStartsOn: number, today: LocalDate): { period: BudgetPeriodName; start: LocalDate | null } {
  const { period } = selection;
  if (period === "CUSTOM") return { period, start: null };
  const base = selection.start ?? (period === "MONTHLY" ? startOfMonth(today) : startOfWeek(today, weekStartsOn));
  if (!view) return { period, start: base };
  let next = base;
  for (let i = 0; i < 24; i++) {
    next = shiftPeriod(period, next, 1, weekStartsOn).start;
    if (!budgets.some((b) => b.period === period && b.startDate === next)) break;
  }
  return { period, start: next };
}
