import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Bell, CalendarDays, FileUp, Laptop, LineChart, PiggyBank, ShieldCheck, Smartphone, Sparkles, Wallet, Workflow } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { COMPLIANCE_NOTICE } from "@/lib/banking-core";
import { isEnabled } from "@/lib/flags";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { DemoButton } from "@/components/landing/demo-button";

export const metadata: Metadata = { title: { absolute: "Harbour — budgeting and money organisation" } };

const FEATURES = [
  { icon: Wallet, title: "Safe to spend", body: "One number for what you can spend before payday, after bills, planned savings and your cash buffer." },
  { icon: PiggyBank, title: "Budgets and goals", body: "Monthly budgets with rollovers and alerts, and savings goals that tell you how much to put aside each week." },
  { icon: CalendarDays, title: "Bills and subscriptions", body: "A calendar of what's due, what's paid, and every subscription with its yearly cost." },
  { icon: LineChart, title: "Cash-flow forecast", body: "See your balance over the next 30 to 90 days from expected pay, bills and your usual spending." },
  { icon: Workflow, title: "Automations", body: "When a paycheque lands, plan 10% for your emergency fund. When Uber shows up, file it under transport." },
  { icon: Bell, title: "Helpful alerts", body: "Low balance, a large purchase, a bill due tomorrow, a budget at 80%: you choose what to hear about." },
];

export default async function HomePage() {
  const user = await getSessionUser().catch(() => null);
  if (user) redirect(user.onboardingCompletedAt ? "/dashboard" : "/onboarding");
  const demo = isEnabled("DEMO_MODE");

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2" aria-label="Account">
          <Button variant="ghost" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/sign-up">Get started</Link>
          </Button>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
              <Sparkles className="size-3.5 text-primary" aria-hidden /> Made for Quebec and the rest of Canada · CAD
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">Know where your money goes, and what&apos;s safe to spend next.</h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              Harbour brings your accounts, budgets, savings goals, bills and cash flow into one calm place. Import a CSV from Neo Financial or any bank, or connect through a secure data provider.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/sign-up">
                  Create your free account <ArrowRight />
                </Link>
              </Button>
              {demo ? <DemoButton /> : null}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-subtle/60" aria-labelledby="features">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="features" className="text-2xl font-semibold tracking-tight">
              Everything in one place
            </h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2" aria-label="Privacy and devices">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <ShieldCheck className="size-6 text-positive" aria-hidden /> Your data, your rules
            </h2>
            <ul className="mt-5 space-y-3 text-[15px] text-muted-foreground">
              <li>Harbour never asks for or stores your bank password. Bank connections happen inside a regulated provider&apos;s own window.</li>
              <li>
                <FileUp className="mr-1.5 inline size-4 align-[-2px] text-foreground" aria-hidden />
                Prefer not to connect? Import CSV files: only the file you choose is read.
              </li>
              <li>Export everything as CSV whenever you like, or delete your account and data.</li>
              <li>Harbour organises and plans. It never moves money for you.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">On your iPhone and Mac</h2>
            <ul className="mt-5 space-y-4 text-[15px] text-muted-foreground">
              <li className="flex gap-3">
                <Smartphone className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden />
                <span>On iPhone, open Harbour in Safari, tap Share, then “Add to Home Screen”. It opens full screen like an app.</span>
              </li>
              <li className="flex gap-3">
                <Laptop className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden />
                <span>On a Mac, use the Harbour desktop app, which keeps your data on your own computer, or add the site to your Dock from Safari (File → Add to Dock).</span>
              </li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:px-6">
          <p className="max-w-3xl">{COMPLIANCE_NOTICE}</p>
          <p>
            <Link href="/legal" className="hover:text-foreground hover:underline">
              Terms and privacy
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
