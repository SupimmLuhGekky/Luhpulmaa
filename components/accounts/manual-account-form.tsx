"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AccountType } from "@prisma/client";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { ACCOUNT_CURRENCIES, manualAccountSchema } from "@/lib/accounts/schemas";
import { CASH_TYPES, hasCreditLimit, isLiability } from "@/lib/accounts/types";
import { createManualAccountAction } from "@/app/actions/accounts";
import { AccountTypeOptions } from "./account-type-options";
import { MoneyField } from "./money-field";

// Debts are entered as the amount owed, so they can't be negative here.
const schema = manualAccountSchema.superRefine((v, ctx) => {
  if (isLiability(v.type) && v.balanceCents < 0) ctx.addIssue({ code: "custom", path: ["balanceCents"], message: "Enter what you owe as a positive amount" });
});

type Input = z.input<typeof schema>;
type Output = z.output<typeof schema>;

function balanceCopy(type: AccountType | "") {
  if (type && isLiability(type)) return { label: "Amount owed", hint: "What you owe today, as a positive amount." };
  if (type === "INVESTMENT" || type === "OTHER_ASSET") return { label: "Current value", hint: "What it's worth today." };
  if (type && CASH_TYPES.includes(type)) return { label: "Current balance", hint: type === "CASH" ? "How much cash you have on hand." : "Use a minus sign if the account is overdrawn." };
  return { label: "Current balance", hint: "For a debt, enter the amount owed." };
}

export interface ManualAccountFormProps {
  /** The user's currency, used when multi-currency is off. */
  currency: string;
  multiCurrency: boolean;
}

/** Add an account by hand. It never syncs: the user keeps its balance up to date. */
export function ManualAccountForm({ currency, multiCurrency }: ManualAccountFormProps) {
  const router = useRouter();
  const f = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const defaultCurrency = (ACCOUNT_CURRENCIES as readonly string[]).includes(currency) ? (currency as Input["currency"]) : "CAD";
  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", type: "" as AccountType, institutionName: "", currency: defaultCurrency, balanceCents: undefined, creditLimitCents: null, mask: "" },
  });
  const errors = form.formState.errors;
  const type = form.watch("type") as AccountType | "";
  const accountCurrency = form.watch("currency") ?? defaultCurrency;
  const liability = type ? isLiability(type) : false;
  const balance = balanceCopy(type);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await createManualAccountAction({
      ...v,
      institutionName: v.institutionName || undefined,
      mask: v.mask || undefined,
      creditLimitCents: hasCreditLimit(v.type) ? (v.creditLimitCents ?? null) : null,
    });
    if (!res.ok) {
      setError(res.error.message);
      for (const [key, messages] of Object.entries(res.error.fieldErrors ?? {})) {
        if (key in v && messages[0]) form.setError(key as keyof Input, { message: messages[0] });
      }
      return;
    }
    toast.success(`${v.name} added`, { description: "Update its balance whenever it changes, and add or import its transactions." });
    router.push(`/accounts/${res.data.id}`);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="New manual account">
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account name" error={errors.name?.message} required>
          <Input autoComplete="off" maxLength={60} placeholder="e.g. Everyday account" {...form.register("name")} />
        </Field>
        <Field label="Type" error={errors.type?.message} hint={type ? (liability ? "Counts as a debt in your net worth." : "Counts as an asset in your net worth.") : undefined} required>
          <Select placeholder="Choose a type…" {...form.register("type")}>
            <AccountTypeOptions />
          </Select>
        </Field>
        <Field label="Bank or institution" error={errors.institutionName?.message} hint="Optional.">
          <Input autoComplete="off" maxLength={60} placeholder="e.g. Neo Financial" {...form.register("institutionName")} />
        </Field>
        <Field label="Last 4 digits" error={errors.mask?.message} hint="Optional. Helps tell similar accounts apart.">
          <Input autoComplete="off" inputMode="numeric" maxLength={4} placeholder="1234" className="tabular" {...form.register("mask")} />
        </Field>
        <Field label={balance.label} error={errors.balanceCents?.message} hint={balance.hint} required>
          <MoneyField control={form.control} name="balanceCents" currency={accountCurrency} locale={f.locale} allowNegative={!liability} placeholder="0.00" />
        </Field>
        {type && hasCreditLimit(type) ? (
          <Field label="Credit limit" error={errors.creditLimitCents?.message} hint="Optional. Shows how much of the limit you're using.">
            <MoneyField control={form.control} name="creditLimitCents" nullable currency={accountCurrency} locale={f.locale} placeholder="No limit set" />
          </Field>
        ) : null}
        {multiCurrency ? (
          <Field label="Currency" error={errors.currency?.message}>
            <Select {...form.register("currency")} options={ACCOUNT_CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </Field>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Manual accounts don&apos;t sync. You update the balance yourself, and add transactions by hand or import them from a CSV file.
        {multiCurrency ? null : ` Amounts are in ${defaultCurrency}.`}
      </p>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild>
          <Link href="/accounts">Cancel</Link>
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Add account
        </Button>
      </div>
    </form>
  );
}
