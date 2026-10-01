"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import { saveIncomeSourceAction } from "@/app/actions/income";
import { monthlyEquivalent } from "@/lib/finance/frequency";
import type { GoalAccountOption } from "@/lib/goals/service";
import { dayOfMonthLabel, FREQUENCY_LABEL, type PayFrequency } from "./labels";

const schema = z
  .object({
    name: z.string().trim().min(1, "Name this income").max(80, "Keep it under 80 characters"),
    frequency: z.enum(["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"]),
    averageAmountCents: z
      .number()
      .int()
      .max(100_000_000, "That's more than Harbour can track")
      .nullable()
      .refine((v) => v !== null && v > 0, "Enter the usual amount"),
    nextExpectedDate: z.string().min(1, "Pick the next payday"),
    day1: z.number().int().min(1).max(31),
    day2: z.number().int().min(1).max(31),
    accountId: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.frequency === "SEMI_MONTHLY" && v.day1 === v.day2) ctx.addIssue({ code: "custom", path: ["day2"], message: "Pick two different days" });
  });

type Values = z.infer<typeof schema>;

export interface IncomeSourceFormValue {
  id: string;
  name: string;
  frequency: string;
  averageAmountCents: number;
  nextExpectedDate: string | null;
  semiMonthlyDays: number[];
  isDetected: boolean;
  matchPattern: string | null;
  account: { id: string; name: string } | null;
}

export function IncomeSourceDialog({ open, onOpenChange, source, accounts }: { open: boolean; onOpenChange: (open: boolean) => void; source: IncomeSourceFormValue | null; accounts: GoalAccountOption[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">{open ? <SourceForm onOpenChange={onOpenChange} source={source} accounts={accounts} /> : null}</DialogContent>
    </Dialog>
  );
}

const DAY_OPTIONS = [...Array.from({ length: 30 }, (_, i) => i + 1), 31];

function SourceForm({ onOpenChange, source, accounts }: { onOpenChange: (open: boolean) => void; source: IncomeSourceFormValue | null; accounts: GoalAccountOption[] }) {
  const router = useRouter();
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const known = source && (["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"] as string[]).includes(source.frequency) ? (source.frequency as PayFrequency) : "BIWEEKLY";
  const [d1, d2] = source?.semiMonthlyDays.length === 2 ? [...source.semiMonthlyDays].sort((a, b) => a - b) : [15, 31];
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: source?.name ?? "",
      frequency: known,
      averageAmountCents: source?.averageAmountCents ?? null,
      nextExpectedDate: source?.nextExpectedDate ?? "",
      day1: d1,
      day2: d2,
      accountId: source?.account?.id ?? "",
    },
  });
  const errors = form.formState.errors;
  const [frequency, amount] = form.watch(["frequency", "averageAmountCents"]);
  const accountOptions = source?.account && !accounts.some((a) => a.id === source.account!.id) ? [...accounts, { id: source.account.id, name: source.account.name, type: "CHEQUING" as const, mask: null }] : accounts;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await saveIncomeSourceAction({
      id: source?.id ?? null,
      source: {
        name: v.name,
        frequency: v.frequency,
        averageAmountCents: v.averageAmountCents!,
        nextExpectedDate: v.nextExpectedDate,
        semiMonthlyDays: v.frequency === "SEMI_MONTHLY" ? [Math.min(v.day1, v.day2), Math.max(v.day1, v.day2)] : undefined,
        accountId: v.accountId || null,
      },
    });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(source ? "Income updated" : "Income added", { description: v.name });
    onOpenChange(false);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{source ? `Edit ${source.name}` : "Add income"}</DialogTitle>
        <DialogDescription>A paycheque or any regular income. Harbour uses it to estimate paydays and plan ahead.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />
        {source?.matchPattern ? (
          <Notice tone="info" title="Linked to your deposits">
            Harbour notes each paycheque from {source.name} as it arrives. Once you save here, the amount, payday and account you set are kept.
          </Notice>
        ) : null}
        <Field label="Name" error={errors.name?.message} required>
          <Input placeholder="e.g. Salary, Freelance" autoComplete="off" maxLength={80} {...form.register("name")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How often" required>
            <Select {...form.register("frequency")}>
              {(Object.keys(FREQUENCY_LABEL) as PayFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Controller
            control={form.control}
            name="averageAmountCents"
            render={({ field }) => (
              <Field label="Usual amount" required error={errors.averageAmountCents?.message} hint={amount && amount > 0 ? `≈ ${fmt.money(monthlyEquivalent(amount, frequency))} a month (estimate)` : "After tax, what lands in your account"}>
                <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />
              </Field>
            )}
          />
        </div>
        {frequency === "SEMI_MONTHLY" ? (
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={form.control}
              name="day1"
              render={({ field }) => (
                <Field label="First payday">
                  <Select value={String(field.value)} onChange={(e) => field.onChange(Number(e.target.value))} onBlur={field.onBlur}>
                    {DAY_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d === 31 ? "Last day" : dayOfMonthLabel(d)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="day2"
              render={({ field }) => (
                <Field label="Second payday" error={errors.day2?.message}>
                  <Select value={String(field.value)} onChange={(e) => field.onChange(Number(e.target.value))} onBlur={field.onBlur}>
                    {DAY_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d === 31 ? "Last day" : dayOfMonthLabel(d)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            />
          </div>
        ) : null}
        <Controller
          control={form.control}
          name="nextExpectedDate"
          render={({ field }) => (
            <Field label="Next payday" required error={errors.nextExpectedDate?.message} hint="Later paydays are estimated from this date and the schedule.">
              <DatePicker value={field.value || null} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} />
            </Field>
          )}
        />
        <Field label="Deposited to" hint="Optional">
          <Select {...form.register("accountId")}>
            <option value="">Not set</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.mask ? ` ···${a.mask}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {source ? "Save" : "Add income"}
        </Button>
      </DialogFooter>
    </form>
  );
}
