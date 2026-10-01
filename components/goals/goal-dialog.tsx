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
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { CategoryIcon } from "@/components/shared/category-icon";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { createGoalAction, updateGoalAction } from "@/app/actions/goals";
import { addDays } from "@/lib/dates";
import { calculateGoalProgress } from "@/lib/finance/calculations";
import type { GoalAccountOption, GoalListItem } from "@/lib/goals/service";
import { ColorPicker, GOAL_COLORS, GOAL_ICONS, IconPicker } from "./goal-appearance";

const MAX_CENTS = 100_000_000_00;

const schema = z.object({
  name: z.string().trim().min(1, "Give your goal a name").max(60, "Keep it under 60 characters"),
  targetCents: z
    .number()
    .int()
    .max(MAX_CENTS, "That's more than Harbour can track")
    .nullable()
    .refine((v) => v !== null && v > 0, "Enter a target above $0"),
  startingCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
  deadline: z.string().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  linkedAccountId: z.string(),
  description: z.string().trim().max(300, "Keep it under 300 characters"),
});

type Values = z.infer<typeof schema>;

export interface GoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The goal to edit; omit to create one. */
  goal?: GoalListItem | null;
  accounts: GoalAccountOption[];
  /** Called after a successful save, instead of only refreshing (e.g. to leave ?new=1). */
  onSaved?: (result: { id: string; created: boolean }) => void;
}

/** Create or edit a savings goal: target, optional deadline, priority, look and where the money is kept. */
export function GoalDialog(props: GoalDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">{props.open ? <GoalForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function GoalForm({ onOpenChange, goal, accounts, onSaved }: GoalDialogProps) {
  const fmt = useFormat();
  const editing = Boolean(goal);
  const [error, setError] = React.useState<string | null>(null);
  const tomorrow = addDays(fmt.today, 1);

  const form = useForm<Values>({
    resolver: zodResolver(
      schema.superRefine((v, ctx) => {
        // A past deadline can stay on an existing goal (it shows as overdue) but can't be picked anew.
        if (v.deadline && v.deadline < tomorrow && v.deadline !== (goal?.deadline ?? null)) ctx.addIssue({ code: "custom", path: ["deadline"], message: "Pick a date after today" });
      }),
    ),
    defaultValues: {
      name: goal?.name ?? "",
      targetCents: goal?.progress.target ?? null,
      startingCents: null,
      deadline: goal?.deadline ?? null,
      priority: goal?.priority ?? "MEDIUM",
      icon: goal && GOAL_ICONS.some((i) => i.name === goal.icon) ? goal.icon : (goal?.icon ?? "piggy-bank"),
      color: goal?.color ?? GOAL_COLORS[0].value,
      linkedAccountId: goal?.linkedAccount?.id ?? "",
      description: goal?.description ?? "",
    },
  });
  const errors = form.formState.errors;
  const [targetCents, startingCents, deadline, icon, color] = form.watch(["targetCents", "startingCents", "deadline", "icon", "color"]);

  // Linked account may be hidden or closed by now; keep it selectable so saving doesn't drop it.
  const accountOptions = goal?.linkedAccount && !accounts.some((a) => a.id === goal.linkedAccount!.id) ? [...accounts, { id: goal.linkedAccount.id, name: goal.linkedAccount.name, type: "SAVINGS" as const, mask: null }] : accounts;

  const current = editing ? (goal?.progress.current ?? 0) : (startingCents ?? 0);
  const estimate = targetCents && targetCents > 0 && deadline && deadline > fmt.today ? calculateGoalProgress(targetCents, current, deadline, fmt.today) : null;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const common = {
      name: v.name,
      description: v.description || null,
      targetCents: v.targetCents!,
      deadline: v.deadline,
      priority: v.priority,
      icon: v.icon,
      color: v.color,
      linkedAccountId: v.linkedAccountId || null,
    };
    const res = goal ? await updateGoalAction({ id: goal.id, patch: common }) : await createGoalAction({ ...common, startingCents: v.startingCents ?? undefined });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(goal ? "Goal updated" : "Goal created", { description: v.name });
    onOpenChange(false);
    onSaved?.({ id: res.data.id, created: !goal });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{goal ? `Edit ${goal.name}` : "New goal"}</DialogTitle>
        <DialogDescription>{goal ? "Change the target, deadline or how it looks." : "Name what you're saving for and how much you need. A deadline turns it into a plan."}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <div className="flex items-start gap-3">
          <CategoryIcon icon={icon} color={color} size="lg" className="mt-6" />
          <Field label="Name" error={errors.name?.message} required className="flex-1">
            <Input placeholder="e.g. Emergency fund, Japan trip" autoComplete="off" maxLength={60} {...form.register("name")} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="targetCents"
            render={({ field }) => (
              <Field label="Target" error={errors.targetCents?.message} required>
                <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="deadline"
            render={({ field }) => (
              <Field label="Deadline" error={errors.deadline?.message} hint={field.value ? undefined : "Optional"}>
                <DatePicker value={field.value} onChange={field.onChange} locale={fmt.locale} min={tomorrow} clearable placeholder="No deadline" />
              </Field>
            )}
          />
        </div>
        {!editing ? (
          <Controller
            control={form.control}
            name="startingCents"
            render={({ field }) => (
              <Field label="Already saved" hint="Money you've already moved aside for this. It's recorded as an actual transfer, dated today.">
                <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />
              </Field>
            )}
          />
        ) : null}
        <div className="rounded-lg border border-border bg-subtle px-3 py-2.5 text-[13px]" aria-live="polite">
          {estimate ? (
            estimate.isComplete ? (
              <p className="text-foreground">You&apos;ve already reached this target.</p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  To reach {fmt.money(estimate.target)} by {fmt.date(deadline!)}, set aside about
                </p>
                <p className="tabular mt-1 font-medium text-foreground">
                  {fmt.money(estimate.requiredWeekly ?? 0)}/week · {fmt.money(estimate.requiredBiweekly ?? 0)} every 2 weeks · {fmt.money(estimate.requiredMonthly ?? 0)}/month
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Estimate, starting from {fmt.money(current)} saved.</p>
              </>
            )
          ) : (
            <p className="text-muted-foreground">Add a target and a deadline to see how much to set aside each week, payday or month.</p>
          )}
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Priority</legend>
          <Controller
            control={form.control}
            name="priority"
            render={({ field }) => (
              <Segmented
                aria-label="Priority"
                className="w-full"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: "LOW", label: "Low" },
                  { value: "MEDIUM", label: "Medium" },
                  { value: "HIGH", label: "High" },
                ]}
              />
            )}
          />
        </fieldset>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium" aria-hidden>
            Icon
          </p>
          <Controller control={form.control} name="icon" render={({ field }) => <IconPicker value={field.value} onChange={field.onChange} color={color} />} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium" aria-hidden>
            Colour
          </p>
          <Controller control={form.control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />
        </div>
        <Field label="Where the money is kept" hint="Optional. Just a label — Harbour doesn't move money between accounts.">
          <Select {...form.register("linkedAccountId")}>
            <option value="">Not linked to an account</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.mask ? ` ···${a.mask}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" error={errors.description?.message}>
          <Textarea rows={2} placeholder="Optional" maxLength={300} {...form.register("description")} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {goal ? "Save goal" : "Create goal"}
        </Button>
      </DialogFooter>
    </form>
  );
}
