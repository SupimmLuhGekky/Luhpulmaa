"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Field, FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { formatCurrency } from "@/lib/finance/money";
import { formatDate } from "@/lib/dates";
import { CURRENCY_OPTIONS, LOCALE_OPTIONS, timeZoneLabel, WEEK_START_OPTIONS } from "@/lib/settings/options";
import { updateRegionAction } from "@/app/actions/settings";
import { SettingsSection } from "./settings-ui";

type Currency = "CAD" | "USD" | "EUR" | "GBP";
type Locale = "en-CA" | "fr-CA" | "en-US";

interface Values {
  currency: Currency;
  locale: Locale;
  timeZone: string;
  weekStartsOn: string;
}

export interface RegionFormProps {
  initial: { currency: string; locale: string; timeZone: string; weekStartsOn: number };
  timeZones: string[];
  today: string;
  multiCurrency: boolean;
  /** "profile" shows language and time zone only. */
  variant?: "profile" | "full";
}

export function RegionForm({ initial, timeZones, today, multiCurrency, variant = "full" }: RegionFormProps) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const defaults: Values = {
    currency: (CURRENCY_OPTIONS.some((c) => c.value === initial.currency) ? initial.currency : "CAD") as Currency,
    locale: (LOCALE_OPTIONS.some((l) => l.value === initial.locale) ? initial.locale : "en-CA") as Locale,
    timeZone: initial.timeZone,
    weekStartsOn: String(initial.weekStartsOn),
  };
  const form = useForm<Values>({ defaultValues: defaults });
  const v = form.watch();
  const zones = React.useMemo(() => (timeZones.includes(initial.timeZone) ? timeZones : [initial.timeZone, ...timeZones]), [timeZones, initial.timeZone]);
  const currencyChanged = v.currency !== defaults.currency;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await updateRegionAction({ currency: values.currency, locale: values.locale, timeZone: values.timeZone, weekStartsOn: Number(values.weekStartsOn) });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(variant === "profile" ? "Language and time zone saved" : "Currency and region saved");
    form.reset(values);
    router.refresh();
  });

  const sample = (() => {
    try {
      return `${formatDate(today, "medium", v.locale)} · ${formatCurrency(123456, { currency: v.currency, locale: v.locale })} · ${formatCurrency(-4235, { currency: v.currency, locale: v.locale })}`;
    } catch {
      return null;
    }
  })();

  const footer = (
    <>
      {form.formState.isDirty ? (
        <Button type="button" variant="ghost" onClick={() => form.reset()} disabled={form.formState.isSubmitting}>
          Discard
        </Button>
      ) : null}
      <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
        Save changes
      </Button>
    </>
  );

  const localeField = (
    <Field label="Language & formatting" hint={sample ? `Example: ${sample}` : undefined}>
      <Select options={LOCALE_OPTIONS.map((l) => ({ value: l.value, label: l.label }))} {...form.register("locale")} />
    </Field>
  );
  const timeZoneField = (
    <Field label="Time zone" hint="Decides when a day starts for budgets, bills and reminders.">
      <Select options={zones.map((z) => ({ value: z, label: timeZoneLabel(z) }))} {...form.register("timeZone")} />
    </Field>
  );

  if (variant === "profile") {
    return (
      <form onSubmit={onSubmit} noValidate>
        <SettingsSection id="language" title="Language & time zone" description="How dates and amounts are written, and which day it is for you." footer={footer}>
          <div className="space-y-4">
            <FormError message={error} />
            <div className="grid gap-4 sm:grid-cols-2">
              {localeField}
              {timeZoneField}
            </div>
          </div>
        </SettingsSection>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsSection id="region" title="Currency & formatting" description="How amounts, dates and calendars are shown." footer={footer}>
        <div className="space-y-4">
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency" hint={multiCurrency ? "The currency budgets, goals and totals are shown in." : "Harbour works in Canadian dollars for now."}>
              <Select disabled={!multiCurrency} options={CURRENCY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))} {...form.register("currency")} />
            </Field>
            {localeField}
            {timeZoneField}
            <Field label="First day of the week" hint="Used by weekly budgets and calendars.">
              <Select options={WEEK_START_OPTIONS.map((w) => ({ value: String(w.value), label: w.label }))} {...form.register("weekStartsOn")} />
            </Field>
          </div>
          {multiCurrency && currencyChanged ? (
            <Notice tone="warning" title="Amounts are not converted">
              Changing the currency only changes the symbol and formatting. Balances and transactions stay in the currency your bank reports.
            </Notice>
          ) : null}
        </div>
      </SettingsSection>
    </form>
  );
}
