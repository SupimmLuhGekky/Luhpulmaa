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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field, FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import { createBudgetAction } from "@/app/actions/budget";
import { addMonthKey, formatMonthKey, monthKey, startOfWeek, type LocalDate } from "@/lib/dates";
import { budgetHref, periodLabel, type BudgetPeriodName } from "@/lib/budget/periods";
import type { BudgetSummary } from "@/lib/budget/service";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const schema = z
  .object({
    period: z.enum(["MONTHLY", "WEEKLY", "CUSTOM"]),
    month: z.string(),
    weekDate: z.string(),
    customStart: z.string(),
    customEnd: z.string(),
    name: z.string().trim().max(60, "Keep it under 60 characters"),
    mode: z.enum(["STANDARD", "ZERO_BASED"]),
    plannedIncomeCents: z.number().int().min(0).max(100_000_000).nullable(),
    copyFromPrevious: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.period === "WEEKLY" && !v.weekDate) ctx.addIssue({ code: "custom", path: ["weekDate"], message: "Pick a day in the week" });
    if (v.period === "CUSTOM") {
      if (!v.customStart) ctx.addIssue({ code: "custom", path: ["customStart"], message: "Pick a start date" });
      if (!v.customEnd) ctx.addIssue({ code: "custom", path: ["customEnd"], message: "Pick an end date" });
      else if (v.customStart && v.customEnd < v.customStart) ctx.addIssue({ code: "custom", path: ["customEnd"], message: "End after the start date" });
    }
  });

type Values = z.infer<typeof schema>;

export interface CreateBudgetDialogProps {
  open: boolean;
  /** Closing without creating (Cancel, Esc, outside click). */
  onOpenChange: (open: boolean) => void;
  /** Called with the new (or existing) budget's link once the action succeeds; the parent closes and navigates. */
  onCreated: (href: string) => void;
  budgets: BudgetSummary[];
  weekStartsOn: number;
  defaultMode: "STANDARD" | "ZERO_BASED";
  monthlyIncomeTargetCents: number | null;
  initial: { period: BudgetPeriodName; start: LocalDate | null };
}

/** Start a monthly, weekly or custom budget — by default copying the lines of the previous one. */
export function CreateBudgetDialog(props: CreateBudgetDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">{props.open ? <CreateBudgetForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function CreateBudgetForm({ onOpenChange, onCreated, budgets, weekStartsOn, defaultMode, monthlyIncomeTargetCents, initial }: CreateBudgetDialogProps) {
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const thisMonth = monthKey(fmt.today);
  const monthOptions = React.useMemo(() => Array.from({ length: 25 }, (_, i) => addMonthKey(thisMonth, 12 - i)), [thisMonth]);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      period: initial.period,
      month: initial.period === "MONTHLY" && initial.start ? monthKey(initial.start) : thisMonth,
      weekDate: initial.period === "WEEKLY" && initial.start ? initial.start : fmt.today,
      customStart: fmt.today,
      customEnd: "",
      name: "",
      mode: defaultMode,
      plannedIncomeCents: null,
      copyFromPrevious: true,
    },
  });
  const errors = form.formState.errors;
  const [period, month, weekDate, customStart] = form.watch(["period", "month", "weekDate", "customStart"]);
  const copyId = React.useId();

  const start = period === "MONTHLY" ? `${month}-01` : period === "WEEKLY" ? (weekDate ? startOfWeek(weekDate, weekStartsOn) : null) : customStart || null;
  const existing = period !== "CUSTOM" && start ? budgets.find((b) => b.period === period && b.startDate === start) : undefined;
  const previous = start ? budgets.find((b) => b.period === period && b.startDate < start) : undefined;
  const suggestedIncome = previous?.plannedIncomeCents ?? (period === "MONTHLY" ? monthlyIncomeTargetCents : null);

  // Suggest the previous budget's planned income until the person types their own.
  React.useEffect(() => {
    if (!form.getFieldState("plannedIncomeCents").isDirty) form.setValue("plannedIncomeCents", suggestedIncome);
  }, [form, suggestedIncome]);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await createBudgetAction({
      period: v.period,
      startDate: v.period === "MONTHLY" ? `${v.month}-01` : v.period === "WEEKLY" ? v.weekDate : v.customStart,
      endDate: v.period === "CUSTOM" ? v.customEnd : undefined,
      name: v.period === "CUSTOM" && v.name ? v.name : undefined,
      copyFromPrevious: v.copyFromPrevious && Boolean(previous),
      mode: v.mode,
      plannedIncomeCents: v.plannedIncomeCents,
    });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    const label = periodLabel(res.data.period, res.data.start, res.data.end, fmt.locale);
    if (res.data.created) toast.success("Budget created", { description: label });
    else toast.info("That budget already exists", { description: `Opened ${label}.` });
    onCreated(budgetHref({ period: res.data.period, start: res.data.start, id: res.data.id }));
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>New budget</DialogTitle>
        <DialogDescription>Plan a month, a week or any stretch of days. You can change everything later.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <Controller
          control={form.control}
          name="period"
          render={({ field }) => (
            <Segmented
              aria-label="Budget period"
              className="w-full"
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: "MONTHLY", label: "Monthly" },
                { value: "WEEKLY", label: "Weekly" },
                { value: "CUSTOM", label: "Custom" },
              ]}
            />
          )}
        />
        {period === "MONTHLY" ? (
          <Field label="Month" required>
            <Select {...form.register("month")}>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMonthKey(m, fmt.locale)}
                  {budgets.some((b) => b.period === "MONTHLY" && b.startDate === `${m}-01`) ? " · has a budget" : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {period === "WEEKLY" ? (
          <Controller
            control={form.control}
            name="weekDate"
            render={({ field }) => (
              <Field label="Week" required error={errors.weekDate?.message} hint={start ? `${periodLabel("WEEKLY", start, start, fmt.locale)} · weeks start on ${WEEKDAYS[weekStartsOn] ?? "Sunday"}` : undefined}>
                <DatePicker value={field.value} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} />
              </Field>
            )}
          />
        ) : null}
        {period === "CUSTOM" ? (
          <>
            <Field label="Name" error={errors.name?.message} hint="Optional — e.g. Holidays, Moving month.">
              <Input placeholder="Custom budget" autoComplete="off" {...form.register("name")} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="customStart"
                render={({ field }) => (
                  <Field label="Starts" required error={errors.customStart?.message}>
                    <DatePicker value={field.value} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="customEnd"
                render={({ field }) => (
                  <Field label="Ends" required error={errors.customEnd?.message}>
                    <DatePicker value={field.value} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} min={customStart || undefined} placeholder="Pick an end date" />
                  </Field>
                )}
              />
            </div>
          </>
        ) : null}
        {existing ? (
          <Notice tone="info" title="This period already has a budget">
            {periodLabel(existing.period, existing.startDate, existing.endDate, fmt.locale)} has {existing.lineCount} line{existing.lineCount === 1 ? "" : "s"}. We&apos;ll open it instead of creating another.
          </Notice>
        ) : (
          <>
            <Controller
              control={form.control}
              name="plannedIncomeCents"
              render={({ field }) => (
                <Field label="Planned income" hint="Used for % of income lines and the zero-based view. Leave empty to use income as it arrives.">
                  <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />
                </Field>
              )}
            />
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-[13px] font-medium">Style</legend>
              <Controller
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <Segmented
                    aria-label="Budget style"
                    className="w-full"
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { value: "STANDARD", label: "Standard" },
                      { value: "ZERO_BASED", label: "Zero-based" },
                    ]}
                  />
                )}
              />
              <p className="text-xs text-muted-foreground">
                {form.watch("mode") === "ZERO_BASED" ? "Give every dollar of income a job until nothing is left to assign." : "Set limits for the categories you care about."}
              </p>
            </fieldset>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-subtle px-3 py-3">
              <div className="min-w-0">
                <Label htmlFor={copyId}>{previous ? `Copy lines from ${periodLabel(previous.period, previous.startDate, previous.endDate, fmt.locale)}` : "Copy lines from the previous budget"}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {previous ? `${previous.lineCount} line${previous.lineCount === 1 ? "" : "s"} with their amounts, rollovers and alerts.` : "There's no earlier budget of this kind yet, so you'll start from scratch."}
                </p>
              </div>
              <Controller
                control={form.control}
                name="copyFromPrevious"
                render={({ field }) => <Switch id={copyId} checked={Boolean(previous) && field.value} onCheckedChange={field.onChange} disabled={!previous} />}
              />
            </div>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {existing ? "Open budget" : "Create budget"}
        </Button>
      </DialogFooter>
    </form>
  );
}
