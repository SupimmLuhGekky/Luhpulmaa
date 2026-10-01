"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { PercentInput } from "@/components/budget/percent-input";
import { saveAllocationPlanAction } from "@/app/actions/income";
import { previewAllocation } from "@/lib/income/allocation";
import { AllocationPreviewView, type Destinations } from "./allocation-preview";

const MAX_CENTS = 100_000_000;

const itemSchema = z
  .object({
    label: z.string().trim().min(1, "Name this line").max(60, "Keep it under 60 characters"),
    method: z.enum(["PERCENT", "FIXED"]),
    percentBps: z.number().int().min(0).max(10000).nullable(),
    amountCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
    /** "" (no destination), "goal:<id>" or "category:<id>". */
    target: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.method === "PERCENT" && !v.percentBps) ctx.addIssue({ code: "custom", path: ["percentBps"], message: "Enter a percentage" });
    if (v.method === "FIXED" && !v.amountCents) ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Enter an amount" });
  });

const schema = z.object({
  name: z.string().trim().min(1, "Name your plan").max(60, "Keep it under 60 characters"),
  incomeSourceId: z.string(),
  items: z.array(itemSchema).min(1, "Add at least one line").max(20, "A plan can have up to 20 lines"),
});

type Values = z.infer<typeof schema>;
type Item = Values["items"][number];

export interface PlanFormValue {
  id: string;
  name: string;
  incomeSource: { id: string; name: string; averageAmountCents: number } | null;
  items: { label: string; method: "PERCENT" | "FIXED"; percentBps: number | null; amountCents: number | null; goal: { id: string; name: string } | null; category: { id: string; name: string } | null }[];
}

export interface PlanOptions {
  sources: { id: string; name: string; averageAmountCents: number }[];
  goals: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}

const blankItem = (): Item => ({ label: "", method: "PERCENT", percentBps: null, amountCents: null, target: "" });

/** The classic split: needs, wants and savings (to the first goal, if there is one). */
export function fiftyThirtyTwenty(goals: PlanOptions["goals"]): Item[] {
  return [
    { label: "Needs", method: "PERCENT", percentBps: 5000, amountCents: null, target: "" },
    { label: "Wants", method: "PERCENT", percentBps: 3000, amountCents: null, target: "" },
    { label: goals[0] ? goals[0].name : "Savings", method: "PERCENT", percentBps: 2000, amountCents: null, target: goals[0] ? `goal:${goals[0].id}` : "" },
  ];
}

export function PlanDialog({ open, onOpenChange, plan, options, template }: { open: boolean; onOpenChange: (open: boolean) => void; plan: PlanFormValue | null; options: PlanOptions; template?: "50-30-20" | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open ? <PlanForm onOpenChange={onOpenChange} plan={plan} options={options} template={template ?? null} /> : null}</DialogContent>
    </Dialog>
  );
}

function PlanForm({ onOpenChange, plan, options, template }: { onOpenChange: (open: boolean) => void; plan: PlanFormValue | null; options: PlanOptions; template: "50-30-20" | null }) {
  const router = useRouter();
  const fmt = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const linesId = React.useId();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: plan?.name ?? (template === "50-30-20" ? "50/30/20" : ""),
      incomeSourceId: plan?.incomeSource?.id ?? options.sources[0]?.id ?? "",
      items: plan
        ? plan.items.map((i) => ({ label: i.label, method: i.method, percentBps: i.percentBps, amountCents: i.amountCents, target: i.goal ? `goal:${i.goal.id}` : i.category ? `category:${i.category.id}` : "" }))
        : template === "50-30-20"
          ? fiftyThirtyTwenty(options.goals)
          : [blankItem()],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "items" });
  const errors = form.formState.errors;
  const items = form.watch("items");
  const sourceId = form.watch("incomeSourceId");
  const source = options.sources.find((s) => s.id === sourceId);
  const [previewIncome, setPreviewIncome] = React.useState<number | null>(source?.averageAmountCents ?? plan?.incomeSource?.averageAmountCents ?? 200_000);

  // Follow the chosen income source's usual paycheque until the person types their own.
  const typedIncome = React.useRef(false);
  React.useEffect(() => {
    if (!typedIncome.current && source) setPreviewIncome(source.averageAmountCents);
  }, [source]);

  const destinations: Destinations = React.useMemo(
    () => ({ goals: Object.fromEntries(options.goals.map((g) => [g.id, g.name])), categories: Object.fromEntries(options.categories.map((c) => [c.id, c.name])) }),
    [options.goals, options.categories],
  );
  const parse = (target: string) => ({ goalId: target.startsWith("goal:") ? target.slice(5) : null, categoryId: target.startsWith("category:") ? target.slice(9) : null });
  const preview = previewAllocation(
    previewIncome ?? 0,
    items.map((i) => ({ label: i.label, method: i.method, percentBps: i.percentBps, amountCents: i.amountCents, ...parse(i.target) })),
  );

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await saveAllocationPlanAction({
      id: plan?.id ?? null,
      plan: {
        name: v.name,
        incomeSourceId: v.incomeSourceId || null,
        items: v.items.map((i) => ({ label: i.label, method: i.method, percentBps: i.method === "PERCENT" ? i.percentBps : null, amountCents: i.method === "FIXED" ? i.amountCents : null, ...parse(i.target) })),
      },
    });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(plan ? "Plan saved" : "Plan created", { description: v.name });
    onOpenChange(false);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{plan ? `Edit ${plan.name}` : "New paycheque plan"}</DialogTitle>
        <DialogDescription>Split each paycheque into goals and spending. Goal lines are recorded as planned money when you apply the plan — nothing moves.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-5">
        <FormError message={error ?? (errors.items?.root?.message || errors.items?.message || null)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name" error={errors.name?.message} required>
            <Input placeholder="e.g. Every paycheque" autoComplete="off" maxLength={60} {...form.register("name")} />
          </Field>
          <Field label="For income" hint={options.sources.length ? undefined : "Add an income source to link this plan to it."}>
            <Select {...form.register("incomeSourceId")}>
              <option value="">Any paycheque</option>
              {options.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div role="group" aria-labelledby={linesId}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 id={linesId} className="text-[13px] font-medium">
              Lines
            </h3>
            {!plan ? (
              <Button type="button" variant="ghost" size="sm" className="-mr-2" onClick={() => replace(fiftyThirtyTwenty(options.goals))}>
                <Wand2 /> Use 50/30/20
              </Button>
            ) : null}
          </div>
          <ol className="space-y-3">
            {fields.map((f, idx) => {
              const e = errors.items?.[idx];
              const method = items[idx]?.method ?? "PERCENT";
              return (
                <li key={f.id} className="rounded-lg border border-border p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <Field label={`Line ${idx + 1} name`} error={e?.label?.message}>
                      <Input placeholder="e.g. Savings" autoComplete="off" maxLength={60} {...form.register(`items.${idx}.label`)} />
                    </Field>
                    <Controller
                      control={form.control}
                      name={`items.${idx}.target`}
                      render={({ field }) => (
                        <Field label="Goes to" className="max-sm:col-span-2">
                          <Select
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(ev) => {
                              field.onChange(ev.target.value);
                              // Name an untitled line after where it goes.
                              const { goalId, categoryId } = parse(ev.target.value);
                              const name = goalId ? destinations.goals[goalId] : categoryId ? destinations.categories[categoryId] : null;
                              if (name && !form.getValues(`items.${idx}.label`).trim()) form.setValue(`items.${idx}.label`, name, { shouldValidate: true });
                            }}
                          >
                            <option value="">Just a label</option>
                            {options.goals.length ? (
                              <optgroup label="Goals (recorded as planned)">
                                {options.goals.map((g) => (
                                  <option key={g.id} value={`goal:${g.id}`}>
                                    {g.name}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null}
                            {options.categories.length ? (
                              <optgroup label="Spending categories">
                                {options.categories.map((c) => (
                                  <option key={c.id} value={`category:${c.id}`}>
                                    {c.name}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null}
                          </Select>
                        </Field>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon-sm" className="mt-6 text-muted-foreground max-sm:col-start-2 max-sm:row-start-1" aria-label={`Remove line ${idx + 1}`} disabled={fields.length === 1} onClick={() => remove(idx)}>
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
                    <Controller
                      control={form.control}
                      name={`items.${idx}.method`}
                      render={({ field }) => (
                        <Segmented
                          aria-label={`Line ${idx + 1}: percentage or fixed amount`}
                          size="sm"
                          value={field.value}
                          onChange={field.onChange}
                          options={[
                            { value: "PERCENT", label: "% of pay" },
                            { value: "FIXED", label: "Fixed $" },
                          ]}
                        />
                      )}
                    />
                    {method === "PERCENT" ? (
                      <Controller
                        control={form.control}
                        name={`items.${idx}.percentBps`}
                        render={({ field }) => (
                          <Field label="Share of each paycheque" error={e?.percentBps?.message}>
                            <PercentInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} locale={fmt.locale} placeholder="10" />
                          </Field>
                        )}
                      />
                    ) : (
                      <Controller
                        control={form.control}
                        name={`items.${idx}.amountCents`}
                        render={({ field }) => (
                          <Field label="Amount from each paycheque" error={e?.amountCents?.message}>
                            <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" />
                          </Field>
                        )}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <Button type="button" variant="outline" size="sm" className="mt-3" disabled={fields.length >= 20} onClick={() => append(blankItem())}>
            <Plus /> Add a line
          </Button>
        </div>

        <section aria-label="Preview" className="rounded-xl border border-border bg-subtle p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">Preview</h3>
              <p className="text-xs text-muted-foreground">{source ? `Using ${source.name}'s usual paycheque (estimate). Try another amount:` : "Try it with a paycheque amount:"}</p>
            </div>
            <div className="w-40">
              <CurrencyInput
                aria-label="Paycheque amount for the preview"
                value={previewIncome}
                onChange={(c) => {
                  typedIncome.current = true;
                  setPreviewIncome(c);
                }}
                currency={fmt.currency}
                locale={fmt.locale}
                placeholder="0.00"
              />
            </div>
          </div>
          <AllocationPreviewView className="mt-4" preview={preview} income={previewIncome ?? 0} destinations={destinations} />
        </section>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {plan ? "Save plan" : "Create plan"}
        </Button>
      </DialogFooter>
    </form>
  );
}
