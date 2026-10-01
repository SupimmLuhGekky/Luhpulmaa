"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Target } from "lucide-react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/shared/field";
import { FieldSlot } from "@/components/settings/field-slot";
import { Notice } from "@/components/shared/notice";
import { CategoryIcon } from "@/components/shared/category-icon";
import { RadioCards } from "@/components/settings/radio-cards";
import { useFormat } from "@/components/providers/format-provider";
import { addDays, addYears } from "@/lib/dates";
import { monthlyToReach, type GoalSuggestion } from "@/lib/users/onboarding-plan";
import { createOnboardingGoalAction } from "@/app/actions/onboarding";
import { applyFieldErrors, moneyPlaceholder, StepFooter, StepHeader, useStepNavigation } from "./step-ui";

const CUSTOM = { key: "custom", name: "", icon: "target", color: "#0ea5e9", targetCents: null, hint: "Name it and set the amount." } satisfies GoalSuggestion;

const schema = z.object({
  name: z.string().trim().min(1, "Give your goal a name").max(60),
  targetCents: z
    .number()
    .int()
    .nullable()
    .refine((v) => v !== null && v > 0, "Enter how much you want to save")
    .refine((v) => v === null || v <= 100_000_000_00, "That's more than Harbour can track"),
  startingCents: z.number().int().min(0).nullable(),
  deadline: z.string().nullable(),
});
type Values = z.infer<typeof schema>;
const FIELDS = ["name", "targetCents", "startingCents", "deadline"] as const;

export interface GoalStepProps {
  step: number;
  suggestions: GoalSuggestion[];
  existingGoals: { name: string; targetCents: number }[];
}

export function GoalStep({ step, suggestions, existingGoals }: GoalStepProps) {
  const fmt = useFormat();
  const nav = useStepNavigation(step);
  const [error, setError] = React.useState<string | null>(null);
  const options = React.useMemo(() => [...suggestions, CUSTOM], [suggestions]);
  const [choice, setChoice] = React.useState(options[0].key);
  const chosen = options.find((o) => o.key === choice) ?? CUSTOM;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: options[0].name, targetCents: options[0].targetCents, startingCents: null, deadline: null },
  });
  const errors = form.formState.errors;
  const [target, starting, deadline] = form.watch(["targetCents", "startingCents", "deadline"]);
  const plan = target && target > 0 ? monthlyToReach({ targetCents: target, savedCents: starting, today: fmt.today, deadline }) : null;

  const pick = (key: string) => {
    const next = options.find((o) => o.key === key) ?? CUSTOM;
    setChoice(next.key);
    form.setValue("name", next.name, { shouldValidate: form.formState.isSubmitted });
    if (next.targetCents !== null || next.key === "custom") form.setValue("targetCents", next.targetCents, { shouldValidate: form.formState.isSubmitted });
    if (next.key === "custom") requestAnimationFrame(() => form.setFocus("name"));
  };

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await createOnboardingGoalAction({
      name: v.name,
      targetCents: v.targetCents ?? 0,
      startingCents: v.startingCents ?? 0,
      deadline: v.deadline,
      priority: "MEDIUM",
      icon: chosen.icon,
      color: chosen.color,
    });
    if (!res.ok) {
      if (!applyFieldErrors(res.error.fieldErrors, form.setError, FIELDS)) setError(res.error.message);
      return;
    }
    toast.success(`“${v.name}” created`);
    nav.goTo(res.data.next);
  });

  return (
    <>
      <StepHeader
        step={step}
        title={existingGoals.length ? "Another savings goal?" : "A first savings goal"}
        description="Something you're putting money aside for. Harbour tracks your progress and how much to plan each month."
      />
      {existingGoals.length ? (
        <Notice tone="positive" className="mb-5" title={`You already have ${existingGoals.length === 1 ? "a goal" : `${existingGoals.length} goals`}`}>
          {existingGoals.map((g) => `${g.name} (${fmt.money(g.targetCents, { hideZeroCents: true })})`).join(", ")}. Add another, or continue.
        </Notice>
      ) : null}
      <form id="onboarding-goal" onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={error} />
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-foreground">Start from an idea</legend>
          <RadioCards
            aria-label="Goal ideas"
            columns={3}
            value={choice}
            onChange={pick}
            options={options.map((o) => ({
              value: o.key,
              label: o.key === "custom" ? "Something else" : o.name,
              icon: o.key === "custom" ? <Target className="size-4 text-muted-foreground" aria-hidden /> : <CategoryIcon icon={o.icon} color={o.color} size="sm" />,
            }))}
          />
          {chosen.hint ? <p className="text-xs text-muted-foreground">{chosen.hint}</p> : null}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name?.message} required>
            <Input autoComplete="off" maxLength={60} placeholder="New laptop" {...form.register("name")} />
          </Field>
          <Field label="Amount to save" error={errors.targetCents?.message} required>
            <FieldSlot
              render={(a) => (
                <Controller
                  control={form.control}
                  name="targetCents"
                  render={({ field }) => <CurrencyInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} locale={fmt.locale} currency={fmt.currency} placeholder={moneyPlaceholder(fmt.locale)} />}
                />
              )}
            />
          </Field>
          <Field label="Target date" error={errors.deadline?.message} hint="Optional">
            <FieldSlot
              render={(a) => (
                <Controller
                  control={form.control}
                  name="deadline"
                  render={({ field }) => <DatePicker {...a} value={field.value} onChange={field.onChange} locale={fmt.locale} min={addDays(fmt.today, 1)} max={addYears(fmt.today, 40)} placeholder="No date" clearable />}
                />
              )}
            />
          </Field>
          <Field label="Already set aside" error={errors.startingCents?.message} hint="Optional. Money you've already saved for this yourself.">
            <FieldSlot
              render={(a) => (
                <Controller
                  control={form.control}
                  name="startingCents"
                  render={({ field }) => <CurrencyInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} locale={fmt.locale} currency={fmt.currency} placeholder={moneyPlaceholder(fmt.locale)} />}
                />
              )}
            />
          </Field>
        </div>
        {plan ? (
          <Notice tone="neutral">
            {plan.months === 0 ? (
              "You've already set aside the full amount."
            ) : (
              <>
                Plan about <span className="font-medium text-foreground tabular">{fmt.money(plan.monthlyCents)}</span> a month for {plan.months} {plan.months === 1 ? "month" : "months"} to get there on time.
              </>
            )}
          </Notice>
        ) : null}
        <p className="text-xs text-muted-foreground">Contributions you add later are plans unless you say you moved the money yourself. Harbour never moves money between accounts.</p>
      </form>
      <StepFooter step={step} formId="onboarding-goal" submitLabel="Create goal" pending={form.formState.isSubmitting || nav.navigating} onSkip={nav.advance} skipping={nav.skipping} skipLabel={existingGoals.length ? "Continue" : "Skip for now"} />
    </>
  );
}
