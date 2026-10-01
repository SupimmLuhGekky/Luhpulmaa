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
import { Field, FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import { applyAllocationPlanAction } from "@/app/actions/income";
import { previewAllocation } from "@/lib/income/allocation";
import { AllocationPreviewView, type Destinations } from "./allocation-preview";
import type { PlanFormValue } from "./plan-dialog";

const schema = z.object({
  incomeCents: z
    .number()
    .int()
    .max(100_000_000)
    .nullable()
    .refine((v) => v !== null && v > 0, "Enter the paycheque amount"),
  date: z.string().min(1, "Pick the payday"),
});

type Values = z.infer<typeof schema>;

/**
 * Applies a plan to one paycheque: goal lines are recorded as PLANNED allocations
 * (earmarks). Applying the same plan to the same payday twice records nothing new.
 */
export function ApplyPlanDialog({ open, onOpenChange, plan, destinations, defaultDate }: { open: boolean; onOpenChange: (open: boolean) => void; plan: PlanFormValue | null; destinations: Destinations; defaultDate: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">{open && plan ? <ApplyForm onOpenChange={onOpenChange} plan={plan} destinations={destinations} defaultDate={defaultDate} /> : null}</DialogContent>
    </Dialog>
  );
}

function ApplyForm({ onOpenChange, plan, destinations, defaultDate }: { onOpenChange: (open: boolean) => void; plan: PlanFormValue; destinations: Destinations; defaultDate: string }) {
  const router = useRouter();
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema.superRefine((v, ctx) => v.date > fmt.today && ctx.addIssue({ code: "custom", path: ["date"], message: "Pick a payday that has already happened" }))),
    defaultValues: { incomeCents: plan.incomeSource?.averageAmountCents ?? null, date: defaultDate },
  });
  const errors = form.formState.errors;
  const income = form.watch("incomeCents") ?? 0;
  const preview = previewAllocation(
    income,
    plan.items.map((i) => ({ label: i.label, method: i.method, percentBps: i.percentBps, amountCents: i.amountCents, goalId: i.goal?.id ?? null, categoryId: i.category?.id ?? null })),
  );
  const toGoals = preview.lines.filter((l) => l.goalId && l.amount > 0);
  const goalTotal = toGoals.reduce((a, l) => a + l.amount, 0);
  const hasGoalLines = plan.items.some((i) => i.goal);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await applyAllocationPlanAction({ planId: plan.id, incomeCents: v.incomeCents!, date: v.date });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    const { recorded, recordedCents, alreadyApplied, skippedArchived } = res.data;
    const extra = [alreadyApplied ? `${alreadyApplied} already recorded for this payday` : null, skippedArchived ? `${skippedArchived} archived goal${skippedArchived === 1 ? "" : "s"} skipped` : null].filter(Boolean).join(" · ");
    if (recorded) toast.success(`Recorded ${fmt.money(recordedCents)} as planned`, { description: `${recorded} goal${recorded === 1 ? "" : "s"} · nothing moved${extra ? ` · ${extra}` : ""}` });
    else toast.info("Nothing new to record", { description: extra || "This plan has no goal amounts for that paycheque." });
    onOpenChange(false);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>Apply {plan.name}</DialogTitle>
        <DialogDescription>Record this paycheque&apos;s split. Goal lines are added to your goals as planned money.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <Notice tone="info" title="Planned allocations only">
          Harbour doesn&apos;t move money. Applying a plan earmarks amounts for your goals; move the money yourself when you&apos;re ready.
        </Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="incomeCents"
            render={({ field }) => (
              <Field label="Paycheque amount" required error={errors.incomeCents?.message} hint={plan.incomeSource ? `Usual for ${plan.incomeSource.name}; enter what you were paid.` : "What you were paid."}>
                <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="date"
            render={({ field }) => (
              <Field label="Payday" required error={errors.date?.message} hint="Applying again for the same payday won't double count.">
                <DatePicker value={field.value} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} max={fmt.today} />
              </Field>
            )}
          />
        </div>
        <AllocationPreviewView preview={preview} income={income} destinations={destinations} />
        {hasGoalLines ? (
          <p className="text-[13px] text-foreground">
            {toGoals.length ? (
              <>
                Will record <span className="tabular font-semibold">{fmt.money(goalTotal)}</span> as planned for{" "}
                {toGoals.map((l, i) => (
                  <React.Fragment key={i}>
                    {i ? (i === toGoals.length - 1 ? " and " : ", ") : null}
                    <span className="font-medium">{destinations.goals[l.goalId!] ?? l.label}</span>
                  </React.Fragment>
                ))}
                . Spending lines are a guide and aren&apos;t recorded.
              </>
            ) : (
              "With this amount, no goal line gets any money."
            )}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">This plan has no goal lines, so applying it records nothing. Point a line at a goal to earmark money.</p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} disabled={!hasGoalLines}>
          Record planned allocations
        </Button>
      </DialogFooter>
    </form>
  );
}
