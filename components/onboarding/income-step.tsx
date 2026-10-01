"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FormError } from "@/components/shared/field";
import { FieldSlot } from "@/components/settings/field-slot";
import { Notice } from "@/components/shared/notice";
import { RadioCards } from "@/components/settings/radio-cards";
import { useFormat } from "@/components/providers/format-provider";
import { addDays, type LocalDate } from "@/lib/dates";
import { monthlyEquivalent } from "@/lib/finance/frequency";
import { saveOnboardingIncomeAction } from "@/app/actions/onboarding";
import { applyFieldErrors, moneyPlaceholder, StepFooter, StepHeader, useStepNavigation } from "./step-ui";

const FREQUENCIES = [
  { value: "WEEKLY", label: "Every week", description: "52 paydays a year" },
  { value: "BIWEEKLY", label: "Every 2 weeks", description: "26 paydays a year" },
  { value: "SEMI_MONTHLY", label: "Twice a month", description: "For example the 15th and the last day" },
  { value: "MONTHLY", label: "Once a month", description: "12 paydays a year" },
] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Give this income a name").max(80),
  averageAmountCents: z
    .number()
    .int()
    .nullable()
    .refine((v) => v !== null && v > 0, "Enter the amount of one paycheque")
    .refine((v) => v === null || v <= 100_000_000, "That's more than Harbour can track"),
  frequency: z.enum(["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"]),
  nextExpectedDate: z
    .string()
    .nullable()
    .refine((v) => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose your next payday"),
});
type Values = z.infer<typeof schema>;
type PayFrequency = Values["frequency"];
const FIELDS = ["name", "averageAmountCents", "frequency", "nextExpectedDate"] as const;

export interface IncomeStepProps {
  step: number;
  initial: { name: string; averageAmountCents: number; frequency: string; nextExpectedDate: LocalDate | null } | null;
}

export function IncomeStep({ step, initial }: IncomeStepProps) {
  const fmt = useFormat();
  const nav = useStepNavigation(step);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "Paycheque",
      averageAmountCents: initial?.averageAmountCents ?? null,
      frequency: (FREQUENCIES.some((f) => f.value === initial?.frequency) ? initial?.frequency : "BIWEEKLY") as PayFrequency,
      nextExpectedDate: initial?.nextExpectedDate && initial.nextExpectedDate >= fmt.today ? initial.nextExpectedDate : null,
    },
  });
  const errors = form.formState.errors;
  const amount = form.watch("averageAmountCents");
  const frequency = form.watch("frequency");
  const monthly = amount && amount > 0 ? monthlyEquivalent(amount, frequency) : null;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await saveOnboardingIncomeAction({ name: v.name, averageAmountCents: v.averageAmountCents ?? 0, frequency: v.frequency, nextExpectedDate: v.nextExpectedDate ?? "" });
    if (!res.ok) {
      if (!applyFieldErrors(res.error.fieldErrors, form.setError, FIELDS)) setError(res.error.message);
      return;
    }
    nav.goTo(res.data.next);
  });

  return (
    <>
      <StepHeader
        step={step}
        title="Your income"
        description="Your main paycheque lets Harbour suggest a budget, show what's safe to spend before payday and forecast your cash flow."
      />
      <form id="onboarding-income" onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount of one paycheque" error={errors.averageAmountCents?.message} hint="What lands in your account, after tax and deductions." required>
            <FieldSlot
              render={(a) => (
                <Controller
                  control={form.control}
                  name="averageAmountCents"
                  render={({ field }) => <CurrencyInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} locale={fmt.locale} currency={fmt.currency} placeholder={moneyPlaceholder(fmt.locale)} />}
                />
              )}
            />
          </Field>
          <Field label="Next payday" error={errors.nextExpectedDate?.message} required>
            <FieldSlot
              render={(a) => (
                <Controller
                  control={form.control}
                  name="nextExpectedDate"
                  render={({ field }) => <DatePicker {...a} value={field.value} onChange={field.onChange} locale={fmt.locale} min={fmt.today} max={addDays(fmt.today, 62)} placeholder="Choose a date" />}
                />
              )}
            />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-foreground">How often you&apos;re paid</legend>
          <Controller
            control={form.control}
            name="frequency"
            render={({ field }) => <RadioCards aria-label="How often you're paid" columns={2} value={field.value} onChange={field.onChange} options={FREQUENCIES.map((f) => ({ ...f }))} />}
          />
        </fieldset>
        <Field label="Name" error={errors.name?.message} hint="For example the employer, or “Paycheque”.">
          <Input autoComplete="off" maxLength={80} {...form.register("name")} />
        </Field>
        {monthly ? (
          <Notice tone="neutral">
            That&apos;s about <span className="font-medium text-foreground tabular">{fmt.money(monthly)}</span> a month. It&apos;s an estimate you can change any time on the Income page.
          </Notice>
        ) : null}
      </form>
      <StepFooter step={step} formId="onboarding-income" pending={form.formState.isSubmitting || nav.navigating} onSkip={nav.advance} skipping={nav.skipping} />
    </>
  );
}
