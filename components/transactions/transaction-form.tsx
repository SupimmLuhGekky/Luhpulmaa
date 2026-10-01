"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { createTransactionAction } from "@/app/actions/transactions";
import type { QuickAddOptions } from "@/app/actions/shell";
import { CategoryOptions } from "./category-options";

const schema = z.object({
  direction: z.enum(["out", "in"]),
  amountCents: z.number({ invalid_type_error: "Enter an amount" }).int().positive("Enter an amount above zero").max(10_000_000_00, "Amount is too large"),
  merchantName: z.string().trim().min(1, "Who was it paid to or received from?").max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  accountId: z.string().uuid("Choose an account"),
  categoryId: z.string(),
  notes: z.string().max(1000),
  tags: z.string().max(300),
});

type Values = z.infer<typeof schema>;

export interface TransactionFormProps {
  options: QuickAddOptions;
  defaultAccountId?: string;
  onDone: (createdId: string) => void;
  onCancel?: () => void;
}

/** Add a manual transaction (cash, an e-transfer not yet synced, a correction…). */
export function TransactionForm({ options, defaultAccountId, onDone, onCancel }: TransactionFormProps) {
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: "out",
      amountCents: undefined as unknown as number,
      merchantName: "",
      date: fmt.today,
      accountId: defaultAccountId ?? options.accounts[0]?.id ?? "",
      categoryId: "",
      notes: "",
      tags: "",
    },
  });
  const errors = form.formState.errors;
  const direction = form.watch("direction");

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await createTransactionAction({
      accountId: v.accountId,
      date: v.date,
      amountCents: v.direction === "out" ? -v.amountCents : v.amountCents,
      merchantName: v.merchantName,
      categoryId: v.categoryId || null,
      notes: v.notes.trim() || null,
      tags: v.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Transaction added", { description: `${v.merchantName} · ${fmt.money(v.direction === "out" ? -v.amountCents : v.amountCents, { signed: true })}` });
    onDone(res.data.id);
  });

  if (!options.accounts.length) {
    return <p className="text-sm text-muted-foreground">Add an account first, then you can record transactions in it.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={error} />
      <Controller
        control={form.control}
        name="direction"
        render={({ field }) => (
          <Segmented
            aria-label="Money in or out"
            className="w-full"
            value={field.value}
            onChange={field.onChange}
            options={[
              { value: "out", label: "Money out" },
              { value: "in", label: "Money in" },
            ]}
          />
        )}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" error={errors.amountCents?.message} required>
          <Controller
            control={form.control}
            name="amountCents"
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={(c) => field.onChange(c ?? undefined)} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} autoFocus placeholder="0.00" />
            )}
          />
        </Field>
        <Field label="Date" error={errors.date?.message} required>
          <Controller control={form.control} name="date" render={({ field }) => <DatePicker value={field.value} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} max={fmt.today} />} />
        </Field>
      </div>
      <Field label={direction === "out" ? "Paid to" : "Received from"} error={errors.merchantName?.message} required>
        <Input placeholder={direction === "out" ? "e.g. Marché Jean-Talon" : "e.g. Employer"} autoComplete="off" {...form.register("merchantName")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account" error={errors.accountId?.message} required>
          <Select {...form.register("accountId")} options={options.accounts.map((a) => ({ value: a.id, label: a.mask ? `${a.name} ••${a.mask}` : a.name }))} />
        </Field>
        <Field label="Category" hint="Leave empty to categorise automatically.">
          <Select {...form.register("categoryId")} placeholder="Automatic">
            <CategoryOptions categories={options.categories} direction={direction} />
          </Select>
        </Field>
      </div>
      <Field label="Notes">
        <Textarea rows={2} placeholder="Optional" {...form.register("notes")} />
      </Field>
      <Field label="Tags" hint="Separate tags with commas.">
        <Input placeholder="e.g. Work, Reimbursable" autoComplete="off" {...form.register("tags")} />
      </Field>
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={form.formState.isSubmitting}>
          Add transaction
        </Button>
      </div>
    </form>
  );
}
