"use client";

import * as React from "react";
import type { Frequency } from "@prisma/client";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { REMINDER_OPTIONS, reminderValue } from "@/components/bills/status";
import { FREQUENCY_LABELS } from "@/lib/dates/schedule";
import { SUBSCRIPTION_FREQUENCIES } from "@/lib/subscriptions/upcoming";
import { createSubscriptionAction, updateSubscriptionAction } from "@/app/actions/subscriptions";
import { STATUS_LABELS, type SubscriptionFormOptions, type SubscriptionRow } from "./types";

const schema = z.object({
  name: z.string().trim().min(1, "Give the subscription a name").max(80, "Keep the name under 80 characters"),
  amountCents: z.number({ required_error: "Enter an amount", invalid_type_error: "Enter an amount" }).int().positive("Enter an amount above zero").max(10_000_000, "That amount is too large"),
  frequency: z.string(),
  nextChargeDate: z.string(),
  categoryId: z.string(),
  accountId: z.string(),
  reminder: z.string(),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]),
  notes: z.string().max(300, "Keep notes under 300 characters"),
});

type Values = z.infer<typeof schema>;
const SAVABLE = SUBSCRIPTION_FREQUENCIES as readonly string[];

/** Add or edit a subscription. Saving only updates Harbour; it never changes the subscription with the provider. */
export function SubscriptionDialog({ open, onOpenChange, subscription, options, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription?: SubscriptionRow | null;
  options: SubscriptionFormOptions;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{subscription ? "Edit subscription" : "Add a subscription"}</DialogTitle>
          <DialogDescription>
            {subscription ? "Changes only update Harbour. To change or cancel the plan itself, contact the provider." : "Track a repeating charge like streaming, a phone plan or a membership."}
          </DialogDescription>
        </DialogHeader>
        {open ? <SubscriptionForm key={subscription?.id ?? "new"} subscription={subscription ?? null} options={options} onCancel={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionForm({ subscription: sub, options, onCancel, onSaved }: { subscription: SubscriptionRow | null; options: SubscriptionFormOptions; onCancel: () => void; onSaved: () => void }) {
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: sub
      ? {
          name: sub.name,
          amountCents: sub.amountCents,
          frequency: sub.frequency,
          nextChargeDate: sub.nextChargeDate ?? "",
          categoryId: sub.category?.id ?? "",
          accountId: sub.account?.id ?? "",
          reminder: reminderValue(sub.reminderDaysBefore),
          status: sub.status,
          notes: sub.notes ?? "",
        }
      : { name: "", amountCents: undefined as unknown as number, frequency: "MONTHLY", nextChargeDate: "", categoryId: "", accountId: "", reminder: "3", status: "ACTIVE", notes: "" },
  });
  const errors = form.formState.errors;
  const frequencyOptions = React.useMemo(() => {
    const list = SUBSCRIPTION_FREQUENCIES.map((f) => ({ value: f as string, label: FREQUENCY_LABELS[f] }));
    // A detected schedule we can't save (e.g. twice a month) stays selectable as-is.
    if (sub && !SAVABLE.includes(sub.frequency)) list.push({ value: sub.frequency, label: `${FREQUENCY_LABELS[sub.frequency as Frequency]} (detected)` });
    return list;
  }, [sub]);
  const reminderOptions = React.useMemo(() => {
    const current = sub ? reminderValue(sub.reminderDaysBefore) : null;
    return current && !REMINDER_OPTIONS.some((o) => o.value === current) ? [...REMINDER_OPTIONS, { value: current, label: `${current} days before` }] : REMINDER_OPTIONS;
  }, [sub]);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const frequencyChanged = !sub || v.frequency !== sub.frequency;
    if (frequencyChanged && !SAVABLE.includes(v.frequency)) {
      form.setError("frequency", { message: "Choose how often it's charged" });
      return;
    }
    const payload = {
      name: v.name.trim(),
      amountCents: v.amountCents,
      ...(frequencyChanged ? { frequency: v.frequency as (typeof SUBSCRIPTION_FREQUENCIES)[number] } : {}),
      nextChargeDate: v.nextChargeDate || null,
      categoryId: v.categoryId || null,
      accountId: v.accountId || null,
      reminderDaysBefore: v.reminder === "none" ? null : Number(v.reminder),
      status: v.status,
      notes: v.notes.trim() || null,
    };
    const res = sub ? await updateSubscriptionAction({ id: sub.id, patch: payload }) : await createSubscriptionAction({ ...payload, frequency: payload.frequency ?? "MONTHLY" });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(sub ? "Subscription updated" : "Subscription added", { description: `${payload.name} · ${fmt.money(payload.amountCents)} · ${FREQUENCY_LABELS[v.frequency as Frequency].toLowerCase()}` });
    onSaved();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <Field label="Name" error={errors.name?.message} required>
          <Input placeholder="e.g. Netflix" autoComplete="off" autoFocus={!sub} {...form.register("name")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price" error={errors.amountCents?.message} required>
            <Controller
              control={form.control}
              name="amountCents"
              render={({ field }) => <CurrencyInput value={field.value} onChange={(c) => field.onChange(c ?? undefined)} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />}
            />
          </Field>
          <Field label="Charged" error={errors.frequency?.message} required>
            <Select {...form.register("frequency")} options={frequencyOptions} />
          </Field>
        </div>
        <Field label="Next charge" hint="Leave empty if you're not sure. Later charges repeat from this date.">
          <Controller control={form.control} name="nextChargeDate" render={({ field }) => <DatePicker value={field.value || null} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} clearable />} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            <Select {...form.register("categoryId")} placeholder="None" options={options.categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Charged to">
            <Select {...form.register("accountId")} placeholder="Not set" options={options.accounts.map((a) => ({ value: a.id, label: a.mask ? `${a.name} ••${a.mask}` : a.name }))} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reminder" hint="A notification before each charge.">
            <Select {...form.register("reminder")} options={reminderOptions} />
          </Field>
          {sub ? (
            <Field label="Status" hint="For your records only.">
              <Select {...form.register("status")} options={(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
            </Field>
          ) : null}
        </div>
        <Field label="Notes" error={errors.notes?.message}>
          <Textarea rows={2} placeholder="Optional, e.g. shared with a roommate" {...form.register("notes")} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {sub ? "Save changes" : "Add subscription"}
        </Button>
      </DialogFooter>
    </form>
  );
}
