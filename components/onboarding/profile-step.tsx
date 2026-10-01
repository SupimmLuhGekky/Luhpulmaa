"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/shared/field";
import { RadioCards } from "@/components/settings/radio-cards";
import { formatCurrency } from "@/lib/finance/money";
import { formatDate, type LocalDate } from "@/lib/dates";
import { LOCALE_OPTIONS, timeZoneLabel } from "@/lib/settings/options";
import { saveOnboardingProfileAction } from "@/app/actions/onboarding";
import { applyFieldErrors, StepFooter, StepHeader, useStepNavigation } from "./step-ui";

const schema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(60),
  lastName: z.string().trim().min(1, "Enter your last name").max(60),
  province: z.string().min(1, "Choose your province or territory"),
  locale: z.enum(["en-CA", "fr-CA", "en-US"]),
  timeZone: z.string().min(1, "Choose your time zone"),
});
type Values = z.infer<typeof schema>;
const FIELDS = ["firstName", "lastName", "province", "locale", "timeZone"] as const;

export interface ProfileStepProps {
  step: number;
  initial: { firstName: string; lastName: string; province: string | null; locale: string; timeZone: string };
  provinces: { code: string; name: string }[];
  timeZones: string[];
  today: LocalDate;
}

export function ProfileStep({ step, initial, provinces, timeZones, today }: ProfileStepProps) {
  const nav = useStepNavigation(step);
  const [error, setError] = React.useState<string | null>(null);
  const [deviceZone, setDeviceZone] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: initial.firstName,
      lastName: initial.lastName,
      province: initial.province ?? "",
      locale: (LOCALE_OPTIONS.some((l) => l.value === initial.locale) ? initial.locale : "en-CA") as Values["locale"],
      timeZone: initial.timeZone,
    },
  });
  const errors = form.formState.errors;
  const timeZone = form.watch("timeZone");

  // The device's time zone, read after mounting so server and client render the same markup.
  React.useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // UTC/Etc zones usually mean an unconfigured machine, not where the person lives.
      if (tz && tz.includes("/") && !tz.startsWith("Etc/")) setDeviceZone(tz);
    } catch {
      // Older browsers: no suggestion.
    }
  }, []);

  const zones = React.useMemo(() => {
    const list = [...timeZones];
    for (const z of [initial.timeZone, deviceZone]) if (z && !list.includes(z)) list.unshift(z);
    return list;
  }, [timeZones, initial.timeZone, deviceZone]);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await saveOnboardingProfileAction(v);
    if (!res.ok) {
      if (!applyFieldErrors(res.error.fieldErrors, form.setError, FIELDS)) setError(res.error.message);
      return;
    }
    nav.goTo(res.data.next);
  });

  return (
    <>
      <StepHeader step={step} title="About you" description="Harbour uses your province and time zone to know when your day, week and month start, and how to write dates and amounts." />
      <form id="onboarding-profile" onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={errors.firstName?.message} required>
            <Input autoComplete="given-name" {...form.register("firstName")} />
          </Field>
          <Field label="Last name" error={errors.lastName?.message} required>
            <Input autoComplete="family-name" {...form.register("lastName")} />
          </Field>
          <Field label="Province or territory" error={errors.province?.message} required>
            <Select placeholder="Choose…" options={provinces.map((p) => ({ value: p.code, label: p.name }))} {...form.register("province")} />
          </Field>
          <Field
            label="Time zone"
            error={errors.timeZone?.message}
            hint={
              deviceZone && deviceZone !== timeZone ? (
                <>
                  This device is set to {timeZoneLabel(deviceZone)}.{" "}
                  <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => form.setValue("timeZone", deviceZone, { shouldDirty: true })}>
                    Use it
                  </Button>
                </>
              ) : (
                "When your day starts, for budgets, bills and reminders."
              )
            }
          >
            <Select options={zones.map((z) => ({ value: z, label: timeZoneLabel(z) }))} {...form.register("timeZone")} />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-foreground">How dates and amounts are written</legend>
          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <RadioCards
                aria-label="How dates and amounts are written"
                columns={3}
                value={field.value}
                onChange={field.onChange}
                options={LOCALE_OPTIONS.map((l) => ({ value: l.value, label: l.label, description: sample(l.value, today) }))}
              />
            )}
          />
          <p className="text-xs text-muted-foreground">Amounts are in Canadian dollars. The app itself is in English; this only changes formatting.</p>
        </fieldset>
      </form>
      <StepFooter step={step} formId="onboarding-profile" pending={form.formState.isSubmitting || nav.navigating} />
    </>
  );
}

function sample(locale: string, today: LocalDate) {
  try {
    return `${formatDate(today, "medium", locale)} · ${formatCurrency(123456, { currency: "CAD", locale })}`;
  } catch {
    return undefined;
  }
}
