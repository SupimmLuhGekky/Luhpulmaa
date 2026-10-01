"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { saveBudgetLineAction } from "@/app/actions/budget";
import { mulDiv } from "@/lib/finance/money";
import type { BudgetLineView } from "@/lib/budget/service";
import { PercentInput } from "./percent-input";
import { ThresholdPicker } from "./threshold-picker";

const schema = z
  .object({
    categoryId: z.string(),
    label: z.string().trim().max(60, "Keep it under 60 characters"),
    amountType: z.enum(["FIXED", "PERCENT_OF_INCOME"]),
    amountCents: z.number().int().min(0).max(100_000_000, "That's more than we can plan for").nullable(),
    percentBps: z.number().int().nullable(),
    rolloverEnabled: z.boolean(),
    alertThresholds: z.array(z.number().int().min(1).max(200)).max(6),
  })
  .superRefine((v, ctx) => {
    if (!v.categoryId && !v.label) ctx.addIssue({ code: "custom", path: ["label"], message: "Name this line, or pick a category" });
    if (v.amountType === "FIXED" && v.amountCents === null) ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Enter an amount" });
    if (v.amountType === "PERCENT_OF_INCOME" && (v.percentBps === null || v.percentBps <= 0)) ctx.addIssue({ code: "custom", path: ["percentBps"], message: "Enter a percentage from 0.01 to 100" });
  });

type Values = z.infer<typeof schema>;

export interface LineCategory {
  id: string;
  name: string;
}

export interface BudgetLineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budgetId: string;
  period: "MONTHLY" | "WEEKLY" | "CUSTOM";
  /** Income the percentages apply to (planned income, or income received when none is planned). */
  incomeBase: number;
  incomeIsPlanned: boolean;
  /** Categories without a line yet. */
  categories: LineCategory[];
  /** The line being edited (omit to add one). */
  line?: BudgetLineView | null;
  /** Prefill for a new line (e.g. from unbudgeted spending). */
  preset?: { categoryId: string | null; amountCents: number | null } | null;
  defaultThresholds: number[];
  /** Whether a new line carries unspent money into next month (the user's setting). */
  defaultRollover?: boolean;
}

/** Add or edit one line of a budget: fixed amount or % of income, rollover and alert thresholds. */
export function BudgetLineDialog(props: BudgetLineDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">{props.open ? <LineForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function LineForm({ onOpenChange, budgetId, period, incomeBase, incomeIsPlanned, categories, line, preset, defaultThresholds, defaultRollover = false }: BudgetLineDialogProps) {
  const router = useRouter();
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const editing = Boolean(line);
  const options = React.useMemo(() => {
    const list = [...categories];
    if (line?.categoryId && !list.some((c) => c.id === line.categoryId)) list.unshift({ id: line.categoryId, name: line.name });
    return list;
  }, [categories, line]);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: line
      ? {
          categoryId: line.categoryId ?? "",
          label: line.categoryId ? "" : line.name,
          amountType: line.amountType,
          amountCents: line.amountType === "FIXED" ? line.budgeted : null,
          percentBps: line.percentBps,
          rolloverEnabled: line.rolloverEnabled,
          alertThresholds: line.alertThresholds,
        }
      : {
          categoryId: preset?.categoryId ?? options[0]?.id ?? "",
          label: "",
          amountType: "FIXED",
          amountCents: preset?.amountCents ?? null,
          percentBps: null,
          rolloverEnabled: defaultRollover,
          alertThresholds: defaultThresholds,
        },
  });
  const errors = form.formState.errors;
  const categoryId = form.watch("categoryId");
  const amountType = form.watch("amountType");
  const percentBps = form.watch("percentBps");
  const rolloverId = React.useId();
  const alertsId = React.useId();

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await saveBudgetLineAction({
      budgetId,
      itemId: line?.id ?? null,
      line: {
        categoryId: v.categoryId || null,
        label: v.categoryId ? null : v.label,
        amountType: v.amountType,
        amountCents: v.amountType === "FIXED" ? (v.amountCents ?? 0) : 0,
        percentBps: v.amountType === "PERCENT_OF_INCOME" ? v.percentBps : null,
        rolloverEnabled: v.rolloverEnabled,
        alertThresholds: v.alertThresholds,
      },
    });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    const name = v.categoryId ? (options.find((c) => c.id === v.categoryId)?.name ?? "Line") : v.label;
    toast.success(editing ? "Budget line updated" : "Budget line added", { description: name });
    onOpenChange(false);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${line?.name}` : "Add a budget line"}</DialogTitle>
        <DialogDescription>Plan how much to spend in a category, or set money aside for something like savings.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <Field label="Category" hint={categoryId ? undefined : "Lines without a category don't track spending — use them for savings or debt payments."}>
          <Select {...form.register("categoryId")}>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="">No category (set money aside)</option>
          </Select>
        </Field>
        {!categoryId ? (
          <Field label="Name" error={errors.label?.message} required>
            <Input placeholder="e.g. Savings, Debt payoff" autoComplete="off" {...form.register("label")} />
          </Field>
        ) : null}
        <fieldset className="space-y-3">
          <legend className="mb-1.5 text-[13px] font-medium">Amount</legend>
          <Controller
            control={form.control}
            name="amountType"
            render={({ field }) => (
              <Segmented
                aria-label="How this line is set"
                className="w-full"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: "FIXED", label: "Fixed amount" },
                  { value: "PERCENT_OF_INCOME", label: "% of income" },
                ]}
              />
            )}
          />
          {amountType === "FIXED" ? (
            <Controller
              control={form.control}
              name="amountCents"
              render={({ field }) => (
                <Field label={period === "WEEKLY" ? "Amount per week" : period === "MONTHLY" ? "Amount per month" : "Amount for this budget"} error={errors.amountCents?.message} required>
                  <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />
                </Field>
              )}
            />
          ) : (
            <Controller
              control={form.control}
              name="percentBps"
              render={({ field }) => (
                <Field
                  label="Share of income"
                  error={errors.percentBps?.message}
                  required
                  hint={
                    incomeBase > 0
                      ? `${percentBps ? `≈ ${fmt.money(mulDiv(incomeBase, percentBps, 10000))} of ` : "Of "}${fmt.money(incomeBase)} ${incomeIsPlanned ? "planned income" : "income received so far"}.`
                      : "Set a planned income in the budget settings so percentages turn into amounts."
                  }
                >
                  <PercentInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} locale={fmt.locale} placeholder="10" />
                </Field>
              )}
            />
          )}
        </fieldset>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-subtle px-3 py-3">
          <div className="min-w-0">
            <Label htmlFor={rolloverId}>Roll over what&apos;s left</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {period === "MONTHLY" ? "Unspent money carries into next month's line. Overspending isn't carried." : "Rollover works on monthly budgets only."}
            </p>
          </div>
          <Controller
            control={form.control}
            name="rolloverEnabled"
            render={({ field }) => <Switch id={rolloverId} checked={field.value} onCheckedChange={field.onChange} disabled={period !== "MONTHLY" && !field.value} />}
          />
        </div>
        <div className="space-y-2">
          <p className="text-[13px] font-medium" id={`${alertsId}-label`}>
            Alerts
          </p>
          <Controller
            control={form.control}
            name="alertThresholds"
            render={({ field }) => <ThresholdPicker id={alertsId} value={field.value} onChange={field.onChange} fallback={defaultThresholds} />}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {editing ? "Save line" : "Add line"}
        </Button>
      </DialogFooter>
    </form>
  );
}
