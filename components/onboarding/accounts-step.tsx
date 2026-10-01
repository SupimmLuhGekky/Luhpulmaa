"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import type { AccountType } from "@prisma/client";
import { ArrowRight, Banknote, CreditCard, FileSpreadsheet, FlaskConical, House, Landmark, PenLine, PiggyBank, PlugZap, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FormError } from "@/components/shared/field";
import { FieldSlot } from "@/components/settings/field-slot";
import { useFormat } from "@/components/providers/format-provider";
import { ACCOUNT_TYPE_LABELS, isLiability } from "@/lib/accounts/types";
import { cn } from "@/lib/utils";
import { addOnboardingAccountAction, connectOnboardingDemoBankAction } from "@/app/actions/onboarding";
import { applyFieldErrors, moneyPlaceholder, StepFooter, StepHeader, useStepNavigation } from "./step-ui";

const TYPE_ICONS: Partial<Record<AccountType, LucideIcon>> = {
  CHEQUING: Wallet,
  SAVINGS: PiggyBank,
  CASH: Banknote,
  CREDIT_CARD: CreditCard,
  LINE_OF_CREDIT: CreditCard,
  MORTGAGE: House,
  INVESTMENT: TrendingUp,
};

const TYPE_ORDER: AccountType[] = ["CHEQUING", "SAVINGS", "CREDIT_CARD", "LINE_OF_CREDIT", "CASH", "INVESTMENT", "LOAN", "MORTGAGE", "OTHER_ASSET", "OTHER_LIABILITY"];

export interface OnboardingAccount {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  balanceCents: number;
  isSimulated: boolean;
}

export interface AccountsStepProps {
  step: number;
  accounts: OnboardingAccount[];
  integrations: { demoBank: boolean; realBank: boolean; providerName: string; csvImport: boolean };
  demoInstitutions: { id: string; name: string; color: string; connected: boolean }[];
}

type Mode = "manual" | "demo" | null;

export function AccountsStep({ step, accounts, integrations, demoInstitutions }: AccountsStepProps) {
  const fmt = useFormat();
  const nav = useStepNavigation(step);
  const [mode, setMode] = React.useState<Mode>(accounts.length ? null : "manual");

  const choices: { key: Exclude<Mode, null>; icon: LucideIcon; title: string; text: string }[] = [
    { key: "manual", icon: PenLine, title: "Add an account by hand", text: "Any bank, card or loan. You keep the balance up to date." },
    ...(integrations.demoBank ? [{ key: "demo" as const, icon: FlaskConical, title: "Try a demo bank", text: "Simulated accounts and transactions. No real bank is contacted." }] : []),
  ];

  return (
    <>
      <StepHeader
        step={step}
        title="Your accounts"
        description="Add the accounts you want to follow: chequing, savings, credit cards, loans. Harbour shows balances and sorts transactions. It never moves money."
      />

      {accounts.length ? (
        <section aria-labelledby="accounts-added" className="mb-6">
          <h2 id="accounts-added" className="text-[13px] font-medium text-foreground">
            Added so far <span className="font-normal text-muted-foreground">· {accounts.length}</span>
          </h2>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {accounts.map((a) => {
              const Icon = TYPE_ICONS[a.type] ?? Landmark;
              const owed = isLiability(a.type);
              return (
                <li key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ACCOUNT_TYPE_LABELS[a.type]}
                      {a.institution ? ` · ${a.institution}` : ""}
                      {a.isSimulated ? " · simulated" : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-sm tabular text-foreground">
                    {fmt.money(a.balanceCents)}
                    {owed ? <span className="block text-[11px] text-muted-foreground">owed</span> : null}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className={cn("grid gap-2.5", choices.length > 1 && "sm:grid-cols-2")}>
        {choices.map((c) => {
          const active = mode === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-expanded={active}
              aria-controls={`accounts-${c.key}`}
              onClick={() => setMode(active ? null : c.key)}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active ? "border-primary bg-primary-soft/60" : "border-border bg-card hover:bg-subtle",
              )}
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} aria-hidden>
                <c.icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{accounts.length && c.key === "manual" ? "Add another account by hand" : c.title}</span>
                <span className="block text-[13px] leading-snug text-muted-foreground">{c.text}</span>
              </span>
            </button>
          );
        })}
      </div>

      {mode === "manual" ? <ManualAccountForm id="accounts-manual" onDone={() => setMode(null)} /> : null}
      {mode === "demo" ? <DemoBankList id="accounts-demo" institutions={demoInstitutions} /> : null}

      {integrations.csvImport || integrations.realBank ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-4">
          <p className="text-[13px] font-medium text-foreground">More ways, once setup is done</p>
          <ul className="mt-2 space-y-2 text-[13px] text-muted-foreground">
            {integrations.realBank ? (
              <li className="flex gap-2">
                <PlugZap className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>Connect your bank through {integrations.providerName}, so balances and transactions update on their own.</span>
              </li>
            ) : null}
            {integrations.csvImport ? (
              <li className="flex gap-2">
                <FileSpreadsheet className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>Import transactions from a CSV file downloaded from your bank&apos;s website.</span>
              </li>
            ) : null}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">The last step links to them, and they&apos;re always on the Accounts page.</p>
        </div>
      ) : null}

      <StepFooter
        step={step}
        primary={
          accounts.length ? (
            <Button onClick={nav.advance} loading={nav.skipping} className="w-full sm:w-auto">
              Continue {nav.skipping ? null : <ArrowRight />}
            </Button>
          ) : (
            <Button variant="outline" onClick={nav.advance} loading={nav.skipping} className="w-full sm:w-auto">
              Skip for now
            </Button>
          )
        }
      />
    </>
  );
}

const manualSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(60),
  type: z.enum(["CHEQUING", "SAVINGS", "CASH", "CREDIT_CARD", "LINE_OF_CREDIT", "LOAN", "MORTGAGE", "INVESTMENT", "OTHER_ASSET", "OTHER_LIABILITY"]),
  balanceCents: z
    .number()
    .int()
    .nullable()
    .refine((v): boolean => v !== null, "Enter the balance (0 is fine)"),
  institutionName: z.string().trim().max(60),
  mask: z
    .string()
    .trim()
    .regex(/^\d{0,4}$/, "Up to 4 digits"),
});
type ManualValues = z.infer<typeof manualSchema>;
const MANUAL_FIELDS = ["name", "type", "balanceCents", "institutionName", "mask"] as const;

function ManualAccountForm({ id, onDone }: { id: string; onDone: () => void }) {
  const router = useRouter();
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<ManualValues>({
    resolver: zodResolver(manualSchema),
    defaultValues: { name: "", type: "CHEQUING", balanceCents: null, institutionName: "", mask: "" },
  });
  const errors = form.formState.errors;
  const type = form.watch("type");
  const owed = isLiability(type);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await addOnboardingAccountAction({
      name: v.name,
      type: v.type,
      balanceCents: v.balanceCents ?? 0,
      currency: "CAD",
      institutionName: v.institutionName || undefined,
      mask: v.mask || undefined,
    });
    if (!res.ok) {
      if (!applyFieldErrors(res.error.fieldErrors, form.setError, MANUAL_FIELDS)) setError(res.error.message);
      return;
    }
    toast.success(`${res.data.name} added`);
    form.reset({ name: "", type: v.type, balanceCents: null, institutionName: "", mask: "" });
    onDone();
    router.refresh();
  });

  return (
    <form id={id} onSubmit={onSubmit} noValidate className="mt-4 space-y-4 rounded-xl border border-border bg-subtle/50 p-4">
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account name" error={errors.name?.message} required>
          <Input autoComplete="off" placeholder="Everyday chequing" maxLength={60} {...form.register("name")} />
        </Field>
        <Field label="Type" error={errors.type?.message}>
          <Select options={TYPE_ORDER.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] }))} {...form.register("type")} />
        </Field>
        <Field label={owed ? "Amount owed today" : "Balance today"} error={errors.balanceCents?.message} hint={owed ? "What you currently owe, as a positive amount." : "Use a minus sign if the account is overdrawn."} required>
          <FieldSlot
            render={(a) => (
              <Controller
                control={form.control}
                name="balanceCents"
                render={({ field }) => <CurrencyInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} allowNegative={!owed} locale={fmt.locale} currency={fmt.currency} placeholder={moneyPlaceholder(fmt.locale)} />}
              />
            )}
          />
        </Field>
        <Field label="Bank or institution" hint="Optional">
          <Input autoComplete="off" placeholder="Desjardins, RBC, Tangerine…" maxLength={60} {...form.register("institutionName")} />
        </Field>
        <Field label="Last 4 digits" error={errors.mask?.message} hint="Optional. Helps tell similar accounts apart.">
          <Input inputMode="numeric" autoComplete="off" maxLength={4} className="max-w-28" {...form.register("mask")} />
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone} disabled={form.formState.isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" loading={form.formState.isSubmitting}>
          Add account
        </Button>
      </div>
    </form>
  );
}

function DemoBankList({ id, institutions }: { id: string; institutions: AccountsStepProps["demoInstitutions"] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  const connect = async (institutionId: string) => {
    setPending(institutionId);
    const res = await connectOnboardingDemoBankAction({ institutionId });
    setPending(null);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    const d = res.data;
    const what = `${d.accounts} ${d.accounts === 1 ? "account" : "accounts"} and ${d.added} ${d.added === 1 ? "transaction" : "transactions"}`;
    if (d.failed) toast.warning(`${d.institution} is connected, but the first sync failed`, { description: d.failed });
    else toast.success(`${d.institution} connected`, { description: `Simulated data: ${what}.` });
    router.refresh();
  };

  return (
    <div id={id} className="mt-4 rounded-xl border border-border bg-subtle/50 p-4">
      <p className="text-[13px] text-muted-foreground">
        A demo bank adds simulated accounts with a few months of made-up transactions, so budgets, goals and forecasts have something to work with. You can disconnect it later in Settings.
      </p>
      <ul className="mt-3 space-y-2">
        {institutions.map((i) => (
          <li key={i.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
            <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: i.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{i.name}</span>
            {i.connected ? (
              <Badge variant="positive">Connected</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => connect(i.id)} loading={pending === i.id} disabled={pending !== null && pending !== i.id}>
                Connect
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
