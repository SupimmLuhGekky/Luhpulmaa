"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { FREQUENCY_LABELS } from "@/lib/dates/schedule";
import { createBillAction, updateBillAction } from "@/app/actions/bills";
import { REMINDER_OPTIONS, reminderValue } from "./status";
import type { BillFormOptions, BillRow } from "./types";

const FREQUENCIES = ["ONE_TIME", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Give the bill a name").max(80, "Keep the name under 80 characters"),
  amountCents: z.number({ required_error: "Enter an amount", invalid_type_error: "Enter an amount" }).int().positive("Enter an amount above zero").max(100_000_000, "That amount is too large"),
  isVariableAmount: z.boolean(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
  frequency: z.enum(FREQUENCIES),
  categoryId: z.string(),
  accountId: z.string(),
  autopay: z.boolean(),
  reminder: z.string(),
  notes: z.string().max(300, "Keep notes under 300 characters"),
});

type Values = z.infer<typeof schema>;

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`} className="mt-0.5" />
    </div>
  );
}

/** Add or edit a bill. Bills are plans and reminders: saving one never moves money. */
export function BillDialog({ open, onOpenChange, bill, options, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bill to edit; omit to add a new one. */
  bill?: BillRow | null;
  options: BillFormOptions;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{bill ? "Edit bill" : "Add a bill"}</DialogTitle>
          <DialogDescription>{bill ? "Changes apply to every due date of this bill." : "Track a bill so it shows on your calendar and in your cash-flow estimate."}</DialogDescription>
        </DialogHeader>
        {open ? <BillForm key={bill?.id ?? "new"} bill={bill ?? null} options={options} onCancel={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BillForm({ bill, options, onCancel, onSaved }: { bill: BillRow | null; options: BillFormOptions; onCancel: () => void; onSaved: () => void }) {
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: bill
      ? {
          name: bill.name,
          amountCents: bill.amountCents,
          isVariableAmount: bill.isVariableAmount,
          dueDate: bill.anchorDate ?? fmt.today,
          frequency: (FREQUENCIES as readonly string[]).includes(bill.frequency) ? (bill.frequency as Values["frequency"]) : "MONTHLY",
          categoryId: bill.category?.id ?? "",
          accountId: bill.account?.id ?? "",
          autopay: bill.autopay,
          reminder: reminderValue(bill.reminderDaysBefore),
          notes: bill.notes ?? "",
        }
      : {
          name: "",
          amountCents: undefined as unknown as number,
          isVariableAmount: false,
          dueDate: "",
          frequency: "MONTHLY",
          categoryId: "",
          accountId: "",
          autopay: false,
          reminder: "3",
          notes: "",
        },
  });
  const errors = form.formState.errors;
  const reminderOptions = React.useMemo(() => {
    const current = bill ? reminderValue(bill.reminderDaysBefore) : null;
    return current && !REMINDER_OPTIONS.some((o) => o.value === current) ? [...REMINDER_OPTIONS, { value: current, label: `${current} days before` }] : REMINDER_OPTIONS;
  }, [bill]);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const payload = {
      name: v.name.trim(),
      amountCents: v.amountCents,
      isVariableAmount: v.isVariableAmount,
      dueDate: v.dueDate,
      frequency: v.frequency,
      categoryId: v.categoryId || null,
      accountId: v.accountId || null,
      autopay: v.autopay,
      reminderDaysBefore: v.reminder === "none" ? null : Number(v.reminder),
      notes: v.notes.trim() || null,
    };
    const res = bill ? await updateBillAction({ id: bill.id, patch: payload }) : await createBillAction(payload);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(bill ? "Bill updated" : "Bill added", { description: `${payload.name} · ${fmt.money(payload.amountCents)} · ${FREQUENCY_LABELS[payload.frequency].toLowerCase()}` });
    onSaved();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <Field label="Name" error={errors.name?.message} required>
          <Input placeholder="e.g. Hydro-Québec" autoComplete="off" autoFocus={!bill} {...form.register("name")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" error={errors.amountCents?.message} required>
            <Controller
              control={form.control}
              name="amountCents"
              render={({ field }) => <CurrencyInput value={field.value} onChange={(c) => field.onChange(c ?? undefined)} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />}
            />
          </Field>
          <Field label="Repeats" error={errors.frequency?.message} required>
            <Select {...form.register("frequency")} options={FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }))} />
          </Field>
        </div>
        <Field
          label={bill ? "First due date" : "Due date"}
          hint={bill ? "Later due dates repeat from this one." : "The next date this bill is due. Repeats from here."}
          error={errors.dueDate?.message}
          required
        >
          <Controller control={form.control} name="dueDate" render={({ field }) => <DatePicker value={field.value || null} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} />} />
        </Field>
        <Controller
          control={form.control}
          name="isVariableAmount"
          render={({ field }) => <SwitchRow id="bill-variable" label="Amount varies" hint="The amount is an estimate (e.g. electricity). You can enter what you paid when you mark it paid." checked={field.value} onChange={field.onChange} />}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            <Select {...form.register("categoryId")} placeholder="None" options={options.categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Paid from">
            <Select {...form.register("accountId")} placeholder="Not set" options={options.accounts.map((a) => ({ value: a.id, label: a.mask ? `${a.name} ••${a.mask}` : a.name }))} />
          </Field>
        </div>
        <Controller
          control={form.control}
          name="autopay"
          render={({ field }) => <SwitchRow id="bill-autopay" label="Autopay" hint="Your bank or the biller takes this payment automatically." checked={field.value} onChange={field.onChange} />}
        />
        <Field label="Reminder" hint="Sent as a notification before the due date.">
          <Select {...form.register("reminder")} options={reminderOptions} />
        </Field>
        <Field label="Notes" error={errors.notes?.message}>
          <Textarea rows={2} placeholder="Optional" {...form.register("notes")} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {bill ? "Save changes" : "Add bill"}
        </Button>
      </DialogFooter>
    </form>
  );
}
