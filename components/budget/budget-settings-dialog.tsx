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
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { updateBudgetSettingsAction } from "@/app/actions/budget";

const schema = z.object({
  name: z.string().trim().min(1, "Give the budget a name").max(60, "Keep it under 60 characters"),
  mode: z.enum(["STANDARD", "ZERO_BASED"]),
  plannedIncomeCents: z.number().int().min(0).max(100_000_000).nullable(),
  notes: z.string().max(500, "Keep notes under 500 characters"),
});

type Values = z.infer<typeof schema>;

export interface BudgetSettings {
  id: string;
  name: string;
  mode: "STANDARD" | "ZERO_BASED";
  plannedIncomeCents: number | null;
  notes: string | null;
}

/** Name, style (standard / zero-based), planned income and notes of one budget. */
export function BudgetSettingsDialog({ open, onOpenChange, budget, actualIncome }: { open: boolean; onOpenChange: (open: boolean) => void; budget: BudgetSettings; actualIncome: number }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">{open ? <SettingsForm onOpenChange={onOpenChange} budget={budget} actualIncome={actualIncome} /> : null}</DialogContent>
    </Dialog>
  );
}

function SettingsForm({ onOpenChange, budget, actualIncome }: { onOpenChange: (open: boolean) => void; budget: BudgetSettings; actualIncome: number }) {
  const router = useRouter();
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: budget.name, mode: budget.mode, plannedIncomeCents: budget.plannedIncomeCents, notes: budget.notes ?? "" },
  });
  const errors = form.formState.errors;
  const mode = form.watch("mode");

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await updateBudgetSettingsAction({ budgetId: budget.id, settings: { name: v.name, mode: v.mode, plannedIncomeCents: v.plannedIncomeCents, notes: v.notes.trim() || null } });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Budget settings saved");
    onOpenChange(false);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>Budget settings</DialogTitle>
        <DialogDescription>These apply to this budget only.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <Field label="Name" error={errors.name?.message} required>
          <Input autoComplete="off" {...form.register("name")} />
        </Field>
        <Controller
          control={form.control}
          name="plannedIncomeCents"
          render={({ field }) => (
            <Field
              label="Planned income"
              hint={`Leave empty to use income as it arrives (${fmt.money(actualIncome)} so far). Percentage lines and the zero-based view use this amount.`}
            >
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
            {mode === "ZERO_BASED" ? "Puts “left to assign” first: give every dollar of income a job." : "Shows spending against the limits you set; what's left to assign stays visible on the side."}
          </p>
        </fieldset>
        <Field label="Notes" error={errors.notes?.message}>
          <Textarea rows={3} placeholder="Optional" {...form.register("notes")} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
