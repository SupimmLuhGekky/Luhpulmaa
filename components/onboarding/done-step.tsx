"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, ArrowUpRight, CircleCheck, FileSpreadsheet, PlugZap, Workflow, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/components/providers/format-provider";
import { FREQUENCY_LABELS } from "@/lib/dates/schedule";
import { formatMonthKey } from "@/lib/dates";
import { onboardingStepHref } from "@/lib/users/onboarding-plan";
import { completeOnboardingAction } from "@/app/actions/onboarding";
import { cn } from "@/lib/utils";
import { StepFooter, StepHeader } from "./step-ui";

export interface DoneStepProps {
  step: number;
  firstName: string;
  profile: { region: string; formatting: string; timeZone: string };
  summary: {
    income: { name: string; frequency: keyof typeof FREQUENCY_LABELS; averageAmountCents: number; monthlyCents: number } | null;
    accounts: { count: number; names: string[] };
    budget: { month: string; lines: number; totalCents: number } | null;
    goals: { name: string; targetCents: number }[];
  };
  next: { csvImport: boolean; realBank: boolean; providerName: string; automations: boolean };
  /** Step numbers, for the "Change" links. */
  steps: { profile: number; income: number; accounts: number; budget: number; goal: number };
}

/** "septembre 2026" → "Septembre 2026" at the start of a line. */
function sentenceStart(text: string) {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function DoneStep({ step, firstName, profile, summary, next, steps }: DoneStepProps) {
  const fmt = useFormat();
  const [going, setGoing] = React.useState<string | null>(null);

  /** Finishes setup, then opens `href` with a full load (the app no longer sends people back here). */
  const finish = async (href: string) => {
    setGoing(href);
    const res = await completeOnboardingAction({ skipped: false });
    if (!res.ok) {
      setGoing(null);
      toast.error(res.error.message);
      return;
    }
    window.location.assign(href);
  };

  const rows: { label: string; value: React.ReactNode; empty: boolean; step: number }[] = [
    { label: "Profile & region", value: `${profile.region} · ${profile.formatting} · ${profile.timeZone}`, empty: false, step: steps.profile },
    {
      label: "Income",
      value: summary.income ? (
        <>
          {summary.income.name}: <span className="tabular">{fmt.money(summary.income.averageAmountCents)}</span> {FREQUENCY_LABELS[summary.income.frequency].toLowerCase()}, about{" "}
          <span className="tabular">{fmt.money(summary.income.monthlyCents, { hideZeroCents: true })}</span> a month
        </>
      ) : (
        "Not added yet"
      ),
      empty: !summary.income,
      step: steps.income,
    },
    {
      label: "Accounts",
      value: summary.accounts.count
        ? `${summary.accounts.count} ${summary.accounts.count === 1 ? "account" : "accounts"}: ${summary.accounts.names.join(", ")}${summary.accounts.count > summary.accounts.names.length ? "…" : ""}`
        : "None yet",
      empty: !summary.accounts.count,
      step: steps.accounts,
    },
    {
      label: "Budget",
      value: summary.budget ? (
        <>
          {sentenceStart(formatMonthKey(summary.budget.month, fmt.locale))}: {summary.budget.lines} {summary.budget.lines === 1 ? "category" : "categories"}, <span className="tabular">{fmt.money(summary.budget.totalCents, { hideZeroCents: true })}</span> planned
        </>
      ) : (
        "Not created yet"
      ),
      empty: !summary.budget,
      step: steps.budget,
    },
    {
      label: summary.goals.length > 1 ? "Savings goals" : "Savings goal",
      value: summary.goals.length ? summary.goals.map((g) => `${g.name} (${fmt.money(g.targetCents, { hideZeroCents: true })})`).join(", ") : "None yet",
      empty: !summary.goals.length,
      step: steps.goal,
    },
  ];

  const links: { href: string; icon: LucideIcon; title: string; text: string }[] = [
    ...(next.realBank ? [{ href: "/accounts/new?method=connect", icon: PlugZap, title: "Connect your bank", text: `Through ${next.providerName}, so balances and transactions update on their own.` }] : []),
    ...(next.csvImport ? [{ href: "/accounts/new?method=csv", icon: FileSpreadsheet, title: "Import a CSV file", text: "Bring in transactions downloaded from your bank's website." }] : []),
    ...(next.automations ? [{ href: "/automations", icon: Workflow, title: "Automate the routine", text: "Sort transactions and plan savings automatically." }] : []),
  ];

  return (
    <>
      <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-positive-soft text-positive" aria-hidden>
        <CircleCheck className="size-6" />
      </span>
      <StepHeader step={step} title={firstName ? `You're all set, ${firstName}` : "You're all set"} description="Here's what Harbour knows so far. Everything can be changed later, from its page or from Settings." />

      <dl className="divide-y divide-border rounded-xl border border-border">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 px-3.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
            <dt className="text-[13px] font-medium text-foreground sm:w-36 sm:shrink-0">{r.label}</dt>
            <dd className={cn("min-w-0 flex-1 text-[13px]", r.empty ? "text-muted-foreground" : "text-foreground")}>{r.value}</dd>
            <dd className="sm:shrink-0">
              <Link href={onboardingStepHref(r.step)} className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">
                {r.empty ? "Add" : "Change"}
                <span className="sr-only"> {r.label.toLowerCase()}</span>
              </Link>
            </dd>
          </div>
        ))}
      </dl>

      {links.length ? (
        <section aria-labelledby="done-next" className="mt-6">
          <h2 id="done-next" className="text-[13px] font-medium text-foreground">
            When you&apos;re ready
          </h2>
          <ul className={cn("mt-2 grid gap-2.5", links.length > 1 && "sm:grid-cols-2", links.length > 2 && "lg:grid-cols-3")}>
            {links.map((l) => (
              <li key={l.href}>
                <button
                  type="button"
                  onClick={() => finish(l.href)}
                  disabled={going !== null}
                  className="group flex h-full w-full items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
                    <l.icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                      {l.title}
                      <ArrowUpRight className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
                    </span>
                    <span className="block text-[13px] leading-snug text-muted-foreground">{going === l.href ? "Opening…" : l.text}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <StepFooter
        step={step}
        primary={
          <Button onClick={() => finish("/dashboard")} loading={going === "/dashboard"} disabled={going !== null && going !== "/dashboard"} className="w-full sm:w-auto">
            Go to my dashboard {going === "/dashboard" ? null : <ArrowRight />}
          </Button>
        }
      />
    </>
  );
}
