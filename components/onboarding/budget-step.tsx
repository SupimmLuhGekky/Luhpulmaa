"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import { onboardingStepHref, SUGGESTED_SAVINGS_BPS, type BudgetSuggestionLine } from "@/lib/users/onboarding-plan";
import { createOnboardingBudgetAction } from "@/app/actions/onboarding";
import { cn } from "@/lib/utils";
import { moneyPlaceholder, StepFooter, StepHeader, useStepNavigation } from "./step-ui";

export interface BudgetStepProps {
  step: number;
  monthLabel: string;
  /** Monthly income from the income step (an estimate), if entered. */
  monthlyIncomeCents: number | null;
  suggestion: { basis: "history" | "income" | "none"; lines: BudgetSuggestionLine[]; historyMonths: number };
  /** Visible expense categories that can be added. */
  categories: { id: string; name: string; icon: string | null; color: string | null; essential: boolean }[];
  /** This month's budget when one already exists. */
  existing: { lines: number; totalCents: number } | null;
  incomeStep: number;
}

interface Line {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  essential: boolean;
  averageCents: number | null;
  amountCents: number | null;
}

export function BudgetStep(props: BudgetStepProps) {
  const { step, monthLabel, existing } = props;
  const fmt = useFormat();
  const nav = useStepNavigation(step);

  if (existing) {
    return (
      <>
        <StepHeader step={step} title={`Your budget for ${monthLabel}`} />
        <Notice tone="positive" title={`You already have a budget for ${monthLabel}`}>
          {existing.lines} {existing.lines === 1 ? "category" : "categories"}, {fmt.money(existing.totalCents)} planned. You can change it any time on the Budget page.
        </Notice>
        <StepFooter
          step={step}
          primary={
            <Button onClick={nav.advance} loading={nav.skipping} className="w-full sm:w-auto">
              Continue {nav.skipping ? null : <ArrowRight />}
            </Button>
          }
        />
      </>
    );
  }
  return <BudgetEditor {...props} />;
}

function BudgetEditor({ step, monthLabel, monthlyIncomeCents, suggestion, categories, incomeStep }: BudgetStepProps) {
  const fmt = useFormat();
  const nav = useStepNavigation(step);
  const [lines, setLines] = React.useState<Line[]>(() => suggestion.lines.map((l) => ({ ...l })));
  const [income, setIncome] = React.useState<number | null>(monthlyIncomeCents);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const total = lines.reduce((a, l) => a + (l.amountCents ?? 0), 0);
  const left = income !== null ? income - total : null;
  const available = categories.filter((c) => !lines.some((l) => l.categoryId === c.id));

  const update = (categoryId: string, amountCents: number | null) => setLines((ls) => ls.map((l) => (l.categoryId === categoryId ? { ...l, amountCents } : l)));
  const remove = (categoryId: string) => setLines((ls) => ls.filter((l) => l.categoryId !== categoryId));
  const add = (categoryId: string) => {
    const c = categories.find((x) => x.id === categoryId);
    if (!c) return;
    setLines((ls) => [...ls, { categoryId: c.id, name: c.name, icon: c.icon, color: c.color, essential: c.essential, averageCents: null, amountCents: null }]);
    // Focus the new amount once it renders.
    requestAnimationFrame(() => document.getElementById(`budget-amount-${c.id}`)?.focus());
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const filled = lines.filter((l) => (l.amountCents ?? 0) > 0);
    if (!filled.length) {
      setError("Enter an amount for at least one category, or skip this step.");
      return;
    }
    setPending(true);
    const res = await createOnboardingBudgetAction({ plannedIncomeCents: income, lines: filled.map((l) => ({ categoryId: l.categoryId, amountCents: l.amountCents ?? 0 })) });
    if (!res.ok) {
      setPending(false);
      setError(res.error.message);
      return;
    }
    toast.success(`Budget for ${monthLabel} created`, { description: `${res.data.lines} ${res.data.lines === 1 ? "category" : "categories"}, ${fmt.money(filled.reduce((a, l) => a + (l.amountCents ?? 0), 0))} planned.` });
    nav.goTo(res.data.next);
  };

  const basisText =
    suggestion.basis === "history"
      ? `Suggested from your average spending over the last ${suggestion.historyMonths} full months, rounded up to the next ${fmt.money(1000, { hideZeroCents: true })}.`
      : suggestion.basis === "income"
        ? `Suggested from your income of ${fmt.money(monthlyIncomeCents ?? 0)} a month: about half for needs, a quarter for wants, and ${Math.round(SUGGESTED_SAVINGS_BPS / 100)}% left for savings and goals.`
        : null;

  return (
    <>
      <StepHeader
        step={step}
        title={`A first budget for ${monthLabel}`}
        description="A monthly limit for each category you want to keep an eye on. These are starting points: change any amount, remove what you don't need, add what's missing."
      />
      <form id="onboarding-budget" onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={error} />
        {basisText ? (
          <Notice tone="neutral">{basisText}</Notice>
        ) : (
          <Notice tone="neutral" title="Start with the categories you care about">
            Add a few categories below.{" "}
            <Link href={onboardingStepHref(incomeStep)} className="font-medium text-foreground underline underline-offset-2">
              Add your income
            </Link>{" "}
            and Harbour will suggest amounts for you.
          </Notice>
        )}

        {lines.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Budget lines">
            {lines.map((l) => (
              <li key={l.categoryId} className="flex items-center gap-3 px-3 py-2.5 sm:px-3.5">
                <CategoryIcon icon={l.icon} color={l.color} size="sm" className="hidden sm:inline-flex" />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`budget-amount-${l.categoryId}`} className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                    <span className="truncate">{l.name}</span>
                    {l.essential ? (
                      <Badge variant="neutral" className="hidden sm:inline-flex">
                        Essential
                      </Badge>
                    ) : null}
                  </label>
                  {l.averageCents ? <p className="text-xs text-muted-foreground tabular">Average {fmt.money(l.averageCents)} a month</p> : null}
                </div>
                <CurrencyInput
                  id={`budget-amount-${l.categoryId}`}
                  value={l.amountCents}
                  onChange={(v) => update(l.categoryId, v)}
                  locale={fmt.locale}
                  currency={fmt.currency}
                  placeholder={moneyPlaceholder(fmt.locale)}
                  className="w-28 shrink-0 sm:w-36"
                />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(l.categoryId)} aria-label={`Remove ${l.name}`}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {available.length ? (
          <div className="max-w-xs">
            <Select aria-label="Add a category" value="" onChange={(e) => add(e.target.value)} placeholder="Add a category…" options={available.map((c) => ({ value: c.id, label: c.name }))} />
          </div>
        ) : null}

        <dl className="grid gap-4 rounded-xl border border-border bg-subtle/50 p-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt>
              <label htmlFor="budget-income" className="block text-xs font-medium text-muted-foreground">
                Income this month{monthlyIncomeCents === null ? " (optional)" : ""}
              </label>
            </dt>
            <dd className="mt-1">
              <CurrencyInput id="budget-income" value={income} onChange={setIncome} locale={fmt.locale} currency={fmt.currency} placeholder={moneyPlaceholder(fmt.locale)} />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Budgeted</dt>
            <dd className="mt-1 text-lg font-semibold tabular text-foreground sm:mt-2">{fmt.money(total)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Left for savings and goals</dt>
            <dd className={cn("mt-1 text-lg font-semibold tabular sm:mt-2", left === null ? "text-muted-foreground" : left < 0 ? "text-danger" : "text-positive")}>
              {left === null ? "—" : fmt.money(left)}
            </dd>
            {left !== null && left < 0 ? <p className="mt-0.5 text-xs text-danger">That&apos;s more than your income.</p> : null}
          </div>
        </dl>
      </form>
      <StepFooter step={step} formId="onboarding-budget" submitLabel="Create budget" pending={pending} onSkip={nav.advance} skipping={nav.skipping} />
    </>
  );
}
