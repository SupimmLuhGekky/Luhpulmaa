"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Bell, Landmark, ListChecks, PiggyBank, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { StepFooter, StepHeader, useStepNavigation } from "./step-ui";

const ITEMS = [
  { icon: UserRound, title: "Profile & region", text: "Your province, language and time zone." },
  { icon: ListChecks, title: "What matters to you", text: "What you'd like Harbour to help with." },
  { icon: Wallet, title: "Income", text: "Your pay and next payday, for budgets and forecasts." },
  { icon: Landmark, title: "Accounts", text: "Add accounts by hand, or try the demo bank." },
  { icon: PiggyBank, title: "Budget & savings goal", text: "A first budget suggested from your income, and a goal." },
  { icon: Bell, title: "Notifications", text: "Choose what Harbour tells you about." },
];

export function WelcomeStep({ firstName }: { firstName: string }) {
  const nav = useStepNavigation(1);
  return (
    <>
      <StepHeader
        step={1}
        title={firstName ? `Welcome to Harbour, ${firstName}` : "Welcome to Harbour"}
        description="Let's set up the basics so your dashboard shows your own numbers from day one. It takes about three minutes, and you can skip any optional step."
      />
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {ITEMS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-xl border border-border bg-subtle/60 p-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary" aria-hidden>
              <Icon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-[13px] leading-snug text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
      <Notice tone="info" title="Harbour organises your money. It never moves it." className="mt-6">
        Harbour is a budgeting tool, not a bank: your money stays where it is. Savings goals and allocations are plans, and any transfer is yours to make, at your bank.{" "}
        <Link href="/legal" target="_blank" rel="noopener" className="font-medium text-foreground underline underline-offset-2">
          Terms and privacy<span className="sr-only"> (opens in a new tab)</span>
        </Link>
      </Notice>
      <StepFooter
        step={1}
        primary={
          <Button onClick={nav.advance} loading={nav.skipping} className="w-full sm:w-auto">
            Let&apos;s get started {nav.skipping ? null : <ArrowRight />}
          </Button>
        }
      />
    </>
  );
}
