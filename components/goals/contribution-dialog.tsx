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
import { Segmented } from "@/components/ui/segmented";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { addContributionAction } from "@/app/actions/goals";
import { KindSwatch } from "./kind";

type Kind = "PLANNED_ALLOCATION" | "USER_REPORTED_TRANSFER";
type Direction = "ADD" | "WITHDRAW";

const schema = z.object({
  kind: z.enum(["PLANNED_ALLOCATION", "USER_REPORTED_TRANSFER"]),
  direction: z.enum(["ADD", "WITHDRAW"]),
  amountCents: z
    .number()
    .int()
    .max(100_000_000_00)
    .nullable()
    .refine((v) => v !== null && v > 0, "Enter an amount above $0"),
  date: z.string().min(1, "Pick a date"),
  note: z.string().trim().max(200, "Keep it under 200 characters"),
});

type Values = z.infer<typeof schema>;

export interface ContributionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: { id: string; name: string; totals: { planned: number; actual: number }; remaining: number };
  initial?: { kind?: Kind; direction?: Direction };
}

/** Record money for a goal: an earmark (planned) or money the person moved themselves (actual). */
export function ContributionDialog(props: ContributionDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">{props.open ? <ContributionForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function ContributionForm({ onOpenChange, goal, initial }: ContributionDialogProps) {
  const router = useRouter();
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(
      schema.superRefine((v, ctx) => {
        if (v.date > fmt.today) ctx.addIssue({ code: "custom", path: ["date"], message: "Pick today or an earlier date" });
        const available = v.kind === "PLANNED_ALLOCATION" ? goal.totals.planned : goal.totals.actual;
        if (v.direction === "WITHDRAW" && v.amountCents && v.amountCents > Math.max(0, available)) {
          ctx.addIssue({ code: "custom", path: ["amountCents"], message: `You can take out up to ${fmt.money(Math.max(0, available))}` });
        }
      }),
    ),
    defaultValues: { kind: initial?.kind ?? "PLANNED_ALLOCATION", direction: initial?.direction ?? "ADD", amountCents: null, date: fmt.today, note: "" },
  });
  const errors = form.formState.errors;
  const [kind, direction, amount] = form.watch(["kind", "direction", "amountCents"]);
  const planned = kind === "PLANNED_ALLOCATION";
  const available = Math.max(0, planned ? goal.totals.planned : goal.totals.actual);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const signed = v.direction === "WITHDRAW" ? -v.amountCents! : v.amountCents!;
    const res = await addContributionAction({ goalId: goal.id, amountCents: signed, date: v.date, kind: v.kind, note: v.note || null });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    const what = v.kind === "PLANNED_ALLOCATION" ? "planned" : "actual";
    toast.success(v.direction === "WITHDRAW" ? `Took out ${fmt.money(v.amountCents!)} (${what})` : `Added ${fmt.money(v.amountCents!)} (${what})`, { description: goal.name });
    onOpenChange(false);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{direction === "WITHDRAW" ? `Take money out of ${goal.name}` : `Add money to ${goal.name}`}</DialogTitle>
        <DialogDescription>Harbour records this for your plan. It doesn&apos;t move money between your accounts.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[13px] font-medium">What kind of money?</legend>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Segmented
                aria-label="What kind of money"
                className="w-full"
                value={field.value}
                onChange={field.onChange}
                options={[
                  {
                    value: "PLANNED_ALLOCATION",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <KindSwatch kind="planned" /> Planned
                      </span>
                    ),
                  },
                  {
                    value: "USER_REPORTED_TRANSFER",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <KindSwatch kind="actual" /> Actual
                      </span>
                    ),
                  },
                ]}
              />
            )}
          />
          <p className="text-xs text-muted-foreground">
            {planned ? "Earmark money for this goal. Nothing moves — it's part of your plan until you move it yourself." : "Money you've already moved yourself, for example into a savings account."}
          </p>
        </fieldset>
        <Controller
          control={form.control}
          name="direction"
          render={({ field }) => (
            <Segmented
              aria-label="Add or take out"
              size="sm"
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: "ADD", label: "Add" },
                { value: "WITHDRAW", label: "Take out" },
              ]}
            />
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="amountCents"
            render={({ field }) => (
              <Field
                label="Amount"
                required
                error={errors.amountCents?.message}
                hint={direction === "WITHDRAW" ? `Up to ${fmt.money(available)} ${planned ? "planned" : "actual"}` : goal.remaining > 0 ? `${fmt.money(goal.remaining)} to go` : undefined}
              >
                <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" autoFocus />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="date"
            render={({ field }) => (
              <Field label="Date" required error={errors.date?.message}>
                <DatePicker value={field.value} onChange={(d) => field.onChange(d ?? "")} locale={fmt.locale} max={fmt.today} />
              </Field>
            )}
          />
        </div>
        <Field label="Note" error={errors.note?.message}>
          <Input placeholder="Optional" autoComplete="off" maxLength={200} {...form.register("note")} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {direction === "WITHDRAW" ? "Take out" : "Add"}
          {amount ? ` ${fmt.money(amount)}` : ""}
        </Button>
      </DialogFooter>
    </form>
  );
}
