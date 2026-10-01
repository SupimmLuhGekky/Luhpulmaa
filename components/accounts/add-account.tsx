"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Check, FileUp, Landmark, PencilLine, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ConnectBank, type SimulatedInstitution } from "./connect-bank";
import { CsvGuide } from "./csv-guide";
import { ManualAccountForm } from "./manual-account-form";
import { ADD_METHODS, type AddMethod, type BankingInfo } from "./types";

export interface AddAccountProps {
  /** From `?method=`; nothing is preselected without it. */
  initialMethod: AddMethod | null;
  banking: BankingInfo;
  institutions: SimulatedInstitution[];
  csvEnabled: boolean;
  multiCurrency: boolean;
  currency: string;
}

interface MethodInfo {
  value: AddMethod;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: { label: string; variant: "primary" | "info" | "neutral" };
  muted?: boolean;
}

function connectInfo(banking: BankingInfo): Pick<MethodInfo, "description" | "badge" | "muted"> {
  if (!banking.enabled || !banking.configured) return { description: "Not available on this server. See your other options.", badge: { label: "Unavailable", variant: "neutral" }, muted: true };
  if (banking.simulated) return { description: "Try a simulated bank with sample data. Nothing real is connected.", badge: { label: "Demo", variant: "info" } };
  if (banking.provider === "PLAID") return { description: "Sign in through Plaid's secure window so balances and transactions update on their own. Neo isn't supported." };
  return { description: `Sign in through ${banking.displayName}'s secure window so balances and transactions update on their own.` };
}

const PANEL_TITLES: Record<AddMethod, { title: string; description: string }> = {
  csv: { title: "Import a CSV file from your bank", description: "Works with almost any bank, including Neo Financial." },
  manual: { title: "Add an account by hand", description: "For cash, loans, investments or any account you'd rather keep up to date yourself." },
  connect: { title: "Connect a bank", description: "Balances and transactions update automatically after you connect." },
};

/** Pick how to add an account (CSV, manual, bank connection); the choice is kept in `?method=`. */
export function AddAccount({ initialMethod, banking, institutions, csvEnabled, multiCurrency, currency }: AddAccountProps) {
  const [method, setMethod] = React.useState<AddMethod | "">(initialMethod ?? "");
  const panelRef = React.useRef<HTMLDivElement>(null);

  const choose = React.useCallback((next: AddMethod, opts: { focus?: boolean } = {}) => {
    setMethod(next);
    const url = new URL(window.location.href);
    url.searchParams.set("method", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    if (opts.focus) requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  const methods: MethodInfo[] = [
    {
      value: "csv",
      icon: FileUp,
      title: "Import a CSV file",
      description: csvEnabled ? "Download transactions from your bank's website, then import the file." : "Turned off on this server.",
      badge: csvEnabled ? { label: "Best for Neo Financial", variant: "primary" } : { label: "Unavailable", variant: "neutral" },
      muted: !csvEnabled,
    },
    { value: "manual", icon: PencilLine, title: "Enter it by hand", description: "Type in the balance and update it yourself. Nothing to connect." },
    { value: "connect", icon: Landmark, title: "Connect a bank", ...connectInfo(banking) },
  ];

  return (
    <TabsPrimitive.Root value={method} onValueChange={(v) => choose(v as AddMethod)}>
      <TabsPrimitive.List aria-label="How to add the account" className="grid gap-3 md:grid-cols-3">
        {methods.map((m) => (
          <TabsPrimitive.Trigger
            key={m.value}
            value={m.value}
            // Short accessible name for the tab and its panel; the details are its description.
            aria-label={m.title}
            aria-describedby={`method-${m.value}-desc`}
            className={cn(
              "group relative flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4 pr-10 text-left shadow-soft transition-colors hover:border-primary/40 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:flex-col md:gap-2.5",
              "data-[state=active]:border-primary data-[state=active]:bg-primary-soft/40 data-[state=active]:ring-1 data-[state=active]:ring-primary",
            )}
          >
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", m.muted ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary")}>
              <m.icon className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-foreground">{m.title}</span>
                {m.badge ? <Badge variant={m.badge.variant}>{m.badge.label}</Badge> : null}
              </span>
              <span id={`method-${m.value}-desc`} className="mt-1 block text-[13px] text-muted-foreground">
                {m.badge ? <span className="sr-only">{m.badge.label}. </span> : null}
                {m.description}
              </span>
            </span>
            <span
              className="absolute right-3 top-3 hidden size-5 items-center justify-center rounded-full bg-primary text-primary-foreground group-data-[state=active]:flex"
              aria-hidden
            >
              <Check className="size-3.5" />
            </span>
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>

      {method === "" ? <p className="mt-4 text-[13px] text-muted-foreground">Choose one of the options above to continue. You can use different ones for different accounts.</p> : null}

      <div ref={panelRef} className="scroll-mt-20">
        {ADD_METHODS.map((m) => (
          <TabsPrimitive.Content key={m} value={m} className="mt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Card className="p-5 sm:p-6">
              <div className="max-w-3xl">
                <div className="mb-5">
                  <h2 className="text-base font-semibold">{PANEL_TITLES[m].title}</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">{PANEL_TITLES[m].description}</p>
                </div>
                {m === "csv" ? <CsvGuide enabled={csvEnabled} onAddManually={() => choose("manual", { focus: true })} /> : null}
                {m === "manual" ? <ManualAccountForm currency={currency} multiCurrency={multiCurrency} /> : null}
                {m === "connect" ? (
                  <ConnectBank banking={banking} institutions={institutions} csvEnabled={csvEnabled} onUseCsv={() => choose("csv", { focus: true })} onUseManual={() => choose("manual", { focus: true })} />
                ) : null}
              </div>
            </Card>
          </TabsPrimitive.Content>
        ))}
      </div>
    </TabsPrimitive.Root>
  );
}
