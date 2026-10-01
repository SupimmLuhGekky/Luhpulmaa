"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, FlaskConical, Info, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field, FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import { RadioCards } from "@/components/settings/radio-cards";
import { ACTION_INFO, FIELD_LABELS, OPERATOR_LABELS, ordinal, TRANSACTION_TYPE_LABELS, TRIGGER_INFO, WEEKDAYS } from "@/lib/automation/describe";
import {
  ACTION_TRIGGERS,
  actionTypeSchema,
  automationInputSchema,
  CONDITION_TRANSACTION_TYPES,
  conditionFieldSchema,
  FIELD_OPERATORS,
  isTransactionTrigger,
  ROUND_UP_CHOICES,
  SCHEDULE_TRIGGERS,
  type ActionType,
  type ConditionField,
  type ConditionOperator,
  type Trigger,
} from "@/lib/automation/schemas";
import { cn } from "@/lib/utils";
import { createAutomationAction, previewAutomationAction, updateAutomationAction } from "@/app/actions/automations";
import type { AutomationPreview } from "@/lib/automation/service";
import { AutomationSentence, TRIGGER_ICONS, useDescribeContext, type AutomationOptions } from "./automation-shared";
import type { BuilderValues } from "./builder-values";
import { PreviewPanel } from "./preview-panel";

const MAX_ITEMS = 10;

/** Settings a freshly chosen action starts with. */
function defaultConfig(type: ActionType, trigger: Trigger, goals: AutomationOptions["goals"]): Record<string, unknown> {
  const onlyGoal = goals.filter((g) => g.status === "ACTIVE");
  const goalId = onlyGoal.length === 1 ? onlyGoal[0].id : undefined;
  switch (type) {
    case "ALLOCATE_TO_GOAL":
      return SCHEDULE_TRIGGERS.includes(trigger) ? { goalId, amountCents: 5000 } : { goalId, percentBps: 1000 };
    case "ROUND_UP_TO_GOAL":
      return { goalId, roundToCents: 100 };
    default:
      return {};
  }
}

function defaultConditionValue(field: ConditionField): string {
  return field === "TYPE" ? "EXPENSE" : "";
}

/** Percent text box storing basis points (12.5% → 1250). */
function PercentInput({
  value,
  onChange,
  id,
  maxBps = 10000,
  ...aria
}: {
  value: number | undefined;
  onChange: (bps: number | undefined) => void;
  id?: string;
  maxBps?: number;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const show = (bps: number | undefined) => (bps === undefined ? "" : String(bps / 100));
  const [text, setText] = React.useState(show(value));
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(show(value));
        }}
        onChange={(e) => {
          const t = e.target.value.replace(",", ".").replace(/[^\d.]/g, "");
          setText(t);
          const n = Number(t);
          onChange(t && Number.isFinite(n) && n > 0 ? Math.min(maxBps, Math.round(n * 100)) : undefined);
        }}
        className="pr-8"
        placeholder="10"
        {...aria}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
    </div>
  );
}

function CategorySelect({
  categories,
  value,
  onChange,
  placeholder = "Choose a category",
  kinds,
  ...rest
}: {
  categories: AutomationOptions["categories"];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  kinds?: ("EXPENSE" | "INCOME" | "TRANSFER")[];
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  const groups = (["EXPENSE", "INCOME", "TRANSFER"] as const)
    .filter((k) => !kinds || kinds.includes(k))
    .map((k) => ({
      kind: k,
      label: k === "EXPENSE" ? "Spending" : k === "INCOME" ? "Income" : "Transfers",
      items: categories.filter((c) => c.kind === k && (!c.isHidden || c.id === value)),
    }))
    .filter((g) => g.items.length);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.kind} label={g.label}>
          {g.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function StepCard({
  step,
  title,
  description,
  children,
  className,
}: {
  step: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const id = `step-${step.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className={cn("rounded-xl border border-border bg-card shadow-soft", className)}>
      <div className="flex items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="mt-px rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-primary-foreground">{step}</span>
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function AutomationBuilder({
  automationId,
  initial,
  options,
  templateName,
}: {
  /** Present when editing an existing automation. */
  automationId?: string;
  initial: BuilderValues;
  options: AutomationOptions;
  /** Set when the builder was opened from a template. */
  templateName?: string;
}) {
  const router = useRouter();
  const fmt = useFormat();
  const ctx = useDescribeContext(options);
  const form = useForm<BuilderValues>({ defaultValues: initial });
  const { control, register, setValue, getValues, formState } = form;
  const errors = formState.errors;
  const conditions = useFieldArray({ control, name: "conditions" });
  const actions = useFieldArray({ control, name: "actions" });
  const values = useWatch({ control }) as BuilderValues;
  const trigger = values.trigger;
  const txnTrigger = isTransactionTrigger(trigger);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [preview, setPreview] = React.useState<{
    data: AutomationPreview;
    signature: string;
  } | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const parkedConditions = React.useRef<BuilderValues["conditions"]>([]);
  const savedRef = React.useRef(false);

  const activeGoals = options.goals.filter((g) => g.status === "ACTIVE");
  const signature = JSON.stringify([values.trigger, values.triggerConfig, values.conditionLogic, values.conditions, values.actions]);
  const plans = values.actions.some((a) => ACTION_INFO[a.type]?.plansMoney);

  // The on/off switch lives in the page header when editing: keep the form in step with it.
  React.useEffect(() => {
    if (automationId) setValue("isActive", initial.isActive, { shouldDirty: false });
  }, [automationId, initial.isActive, setValue]);

  // Warn before leaving with unsaved changes.
  React.useEffect(() => {
    if (!formState.isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (savedRef.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [formState.isDirty]);

  const changeTrigger = (next: Trigger) => {
    const prev = getValues("trigger");
    if (next === prev) return;
    setValue("trigger", next, { shouldDirty: true });
    // Conditions only apply to transaction triggers: park them while another trigger is chosen.
    if (isTransactionTrigger(prev) && !isTransactionTrigger(next)) {
      parkedConditions.current = getValues("conditions");
      conditions.replace([]);
    } else if (!isTransactionTrigger(prev) && isTransactionTrigger(next) && parkedConditions.current.length) {
      conditions.replace(parkedConditions.current);
      parkedConditions.current = [];
    }
    const cfg = getValues("triggerConfig") ?? {};
    if (next === "SCHEDULE_MONTHLY" && !cfg.dayOfMonth) setValue("triggerConfig", { ...cfg, dayOfMonth: 1 }, { shouldDirty: true });
    if (next === "SCHEDULE_WEEKLY" && cfg.dayOfWeek === undefined) setValue("triggerConfig", { ...cfg, dayOfWeek: 5 }, { shouldDirty: true });
    if (next === "BUDGET_THRESHOLD" && !cfg.thresholdPercent) setValue("triggerConfig", { ...cfg, thresholdPercent: 80 }, { shouldDirty: true });
    // Scheduled allocations are fixed amounts.
    getValues("actions").forEach((a, i) => {
      if (a.type === "ALLOCATE_TO_GOAL" && SCHEDULE_TRIGGERS.includes(next) && !a.config.amountCents) {
        setValue(`actions.${i}.config`, { goalId: a.config.goalId, amountCents: 5000 }, { shouldDirty: true });
      }
    });
    form.clearErrors();
  };

  // After a failed save, re-check as the person edits so fixed fields lose their errors.
  const [attempted, setAttempted] = React.useState(false);
  const valuesKey = JSON.stringify(values);
  React.useEffect(() => {
    if (!attempted) return;
    form.clearErrors();
    const raw = getValues();
    const parsed = automationInputSchema.safeParse({ ...raw, description: raw.description.trim() || null });
    if (parsed.success) {
      setFormError(null);
      return;
    }
    showErrors(parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the values change
  }, [attempted, valuesKey]);

  const showErrors = (issues: { path: (string | number)[]; message: string }[]) => {
    let summary: string | null = null;
    for (const issue of issues) {
      const path = issue.path.join(".");
      if (!path) summary ??= issue.message;
      else if (path === "actions" || path === "conditions")
        form.setError(`${path}.root` as FieldPath<BuilderValues>, {
          message: issue.message,
        });
      else
        form.setError(path as FieldPath<BuilderValues>, {
          message: issue.message,
        });
    }
    setFormError(summary ?? "Some details need your attention.");
  };

  const submit = async () => {
    form.clearErrors();
    setFormError(null);
    const raw = getValues();
    const input = { ...raw, description: raw.description.trim() || null };
    const parsed = automationInputSchema.safeParse(input);
    if (!parsed.success) {
      setAttempted(true);
      showErrors(parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
      return;
    }
    setSubmitting(true);
    const res = automationId ? await updateAutomationAction({ id: automationId, input }) : await createAutomationAction(input);
    setSubmitting(false);
    if (!res.ok) {
      if (res.error.fieldErrors && Object.keys(res.error.fieldErrors).length) {
        showErrors(
          Object.entries(res.error.fieldErrors).map(([path, msgs]) => ({
            path: path.split("."),
            message: msgs[0] ?? "Check this",
          })),
        );
      } else setFormError(res.error.message);
      return;
    }
    savedRef.current = true;
    if (automationId) {
      toast.success("Automation saved");
      form.reset(getValues());
      savedRef.current = false;
      router.refresh();
    } else {
      toast.success(`“${parsed.data.name}” created`, {
        description: parsed.data.isActive ? "It runs on new activity from now on." : "It's off until you turn it on.",
      });
      router.push(`/automations/${res.data.id}`);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    const v = getValues();
    // Conditions still missing a value are left out of the dry run.
    const res = await previewAutomationAction({
      trigger: v.trigger,
      triggerConfig: v.triggerConfig,
      conditionLogic: v.conditionLogic,
      conditions: v.conditions.filter((c) => c.value.trim()),
      actions: v.actions,
    });
    setPreviewing(false);
    if (!res.ok) {
      setPreviewError(res.error.fieldErrors ? "Finish the highlighted settings, then try again." : res.error.message);
      return;
    }
    setPreview({ data: res.data, signature });
  };

  const triggerGroups = [
    {
      label: "Transactions",
      triggers: ["TRANSACTION_CREATED", "INCOME_RECEIVED"] as Trigger[],
    },
    {
      label: "On a schedule",
      triggers: ["SCHEDULE_MONTHLY", "SCHEDULE_WEEKLY"] as Trigger[],
    },
    {
      label: "Events",
      triggers: ["SUBSCRIPTION_DETECTED", "BUDGET_THRESHOLD"] as Trigger[],
    },
  ];

  const actionErrors = errors.actions as unknown as (Record<string, { message?: string }> | undefined)[] & { root?: { message?: string } };
  const conditionErrors = errors.conditions as unknown as ({ value?: { message?: string } } | undefined)[] & { root?: { message?: string } };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"
    >
      <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
        {templateName ? (
          <Notice tone="info" title={`From the “${templateName}” template`}>
            Check each step, fill in anything missing, then save. Nothing runs until you do.
          </Notice>
        ) : null}
        <FormError message={formError} />

        <div className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-soft sm:grid-cols-2 sm:p-5">
          <Field label="Name" error={errors.name?.message} required>
            <Input {...register("name")} maxLength={80} placeholder="e.g. Rides → Transportation" autoComplete="off" />
          </Field>
          <Field label="Note for yourself" hint="Optional">
            <Input {...register("description")} maxLength={300} placeholder="Why this exists" autoComplete="off" />
          </Field>
        </div>

        {/* WHEN */}
        <StepCard step="WHEN" title="What starts it">
          <div className="space-y-4">
            {triggerGroups.map((g) => (
              <div key={g.label}>
                <p className="mb-2 text-xs font-medium text-muted-foreground" id={`trigger-group-${g.label}`}>
                  {g.label}
                </p>
                <RadioCards<Trigger>
                  aria-labelledby={`trigger-group-${g.label}`}
                  value={trigger}
                  onChange={changeTrigger}
                  columns={2}
                  options={g.triggers.map((t) => {
                    const Icon = TRIGGER_ICONS[t];
                    return {
                      value: t,
                      label: TRIGGER_INFO[t].label,
                      description: TRIGGER_INFO[t].description,
                      icon: <Icon className="size-4" />,
                    };
                  })}
                />
              </div>
            ))}
            {trigger === "SCHEDULE_MONTHLY" ? (
              <Field
                label="Day of the month"
                error={errors.triggerConfig?.message}
                hint={(values.triggerConfig?.dayOfMonth ?? 1) >= 29 ? "In shorter months it runs on the last day." : undefined}
              >
                <Select
                  value={String(values.triggerConfig?.dayOfMonth ?? "")}
                  onChange={(e) => setValue("triggerConfig", { dayOfMonth: Number(e.target.value) || undefined }, { shouldDirty: true })}
                  className="sm:w-48"
                  options={Array.from({ length: 31 }, (_, i) => ({
                    value: String(i + 1),
                    label: `The ${ordinal(i + 1)}`,
                  }))}
                />
              </Field>
            ) : null}
            {trigger === "SCHEDULE_WEEKLY" ? (
              <Field label="Day of the week" error={errors.triggerConfig?.message}>
                <Select
                  value={values.triggerConfig?.dayOfWeek === undefined ? "" : String(values.triggerConfig.dayOfWeek)}
                  onChange={(e) =>
                    setValue(
                      "triggerConfig",
                      {
                        dayOfWeek: e.target.value === "" ? undefined : Number(e.target.value),
                      },
                      { shouldDirty: true },
                    )
                  }
                  className="sm:w-48"
                  options={WEEKDAYS.map((d, i) => ({
                    value: String(i),
                    label: d,
                  }))}
                />
              </Field>
            ) : null}
            {trigger === "BUDGET_THRESHOLD" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="When spending reaches" error={errors.triggerConfig?.message} hint="Of the category's budget for the month.">
                  <PercentInput
                    maxBps={50000}
                    value={values.triggerConfig?.thresholdPercent === undefined ? undefined : values.triggerConfig.thresholdPercent * 100}
                    onChange={(bps) =>
                      setValue("triggerConfig.thresholdPercent", bps === undefined ? undefined : Math.min(500, Math.max(1, Math.round(bps / 100))), { shouldDirty: true })
                    }
                  />
                </Field>
                <Field label="Of the budget for">
                  <CategorySelect
                    categories={options.categories}
                    kinds={["EXPENSE"]}
                    value={values.triggerConfig?.categoryId ?? ""}
                    onChange={(id) =>
                      setValue("triggerConfig.categoryId", id || undefined, {
                        shouldDirty: true,
                      })
                    }
                    placeholder="Any category"
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </StepCard>

        {/* IF */}
        {txnTrigger ? (
          <StepCard
            step="IF"
            title="Only when"
            description={
              conditions.fields.length ? undefined : `No conditions: it runs for ${trigger === "INCOME_RECEIVED" ? "every income transaction" : "every new transaction"}.`
            }
          >
            <div className="space-y-3">
              {conditions.fields.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-foreground">
                  <span>Match</span>
                  <Controller
                    control={control}
                    name="conditionLogic"
                    render={({ field }) => (
                      <Segmented
                        aria-label="How conditions combine"
                        size="sm"
                        value={field.value}
                        onChange={field.onChange}
                        options={[
                          { value: "ALL", label: "all of these" },
                          { value: "ANY", label: "any of these" },
                        ]}
                      />
                    )}
                  />
                </div>
              ) : null}
              <ol className="space-y-2.5">
                {conditions.fields.map((f, i) => {
                  const c = values.conditions[i] ?? f;
                  const valueError = conditionErrors?.[i]?.value?.message;
                  const valueId = `condition-${i}-value`;
                  return (
                    <li key={f.id} className="rounded-lg border border-border bg-subtle p-3">
                      <div className="flex items-start gap-2">
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[9rem_10rem_minmax(0,1fr)]">
                          <Select
                            aria-label={`Condition ${i + 1} field`}
                            value={c.field}
                            onChange={(e) => {
                              const field = e.target.value as ConditionField;
                              setValue(
                                `conditions.${i}`,
                                {
                                  field,
                                  operator: FIELD_OPERATORS[field][0],
                                  value: defaultConditionValue(field),
                                },
                                { shouldDirty: true },
                              );
                            }}
                            options={conditionFieldSchema.options.map((x) => ({
                              value: x,
                              label: FIELD_LABELS[x],
                            }))}
                          />
                          <Select
                            aria-label={`Condition ${i + 1} comparison`}
                            value={c.operator}
                            onChange={(e) => setValue(`conditions.${i}.operator`, e.target.value as ConditionOperator, { shouldDirty: true })}
                            options={FIELD_OPERATORS[c.field].map((op) => ({
                              value: op,
                              label: OPERATOR_LABELS[op],
                            }))}
                          />
                          <div className="min-w-0">
                            {c.field === "AMOUNT" ? (
                              <CurrencyInput
                                id={valueId}
                                aria-label={`Condition ${i + 1} amount`}
                                aria-invalid={valueError ? true : undefined}
                                value={/^\d+$/.test(c.value) ? Number(c.value) : null}
                                onChange={(cents) => setValue(`conditions.${i}.value`, cents === null ? "" : String(Math.abs(cents)), { shouldDirty: true })}
                                currency={fmt.currency}
                                locale={fmt.locale}
                                placeholder="0.00"
                              />
                            ) : c.field === "CATEGORY" ? (
                              <CategorySelect
                                id={valueId}
                                aria-label={`Condition ${i + 1} category`}
                                aria-invalid={valueError ? true : undefined}
                                categories={options.categories}
                                value={c.value}
                                onChange={(id) =>
                                  setValue(`conditions.${i}.value`, id, {
                                    shouldDirty: true,
                                  })
                                }
                              />
                            ) : c.field === "ACCOUNT" ? (
                              <Select
                                id={valueId}
                                aria-label={`Condition ${i + 1} account`}
                                aria-invalid={valueError ? true : undefined}
                                value={c.value}
                                onChange={(e) => setValue(`conditions.${i}.value`, e.target.value, { shouldDirty: true })}
                                placeholder="Choose an account"
                                options={options.accounts.map((a) => ({
                                  value: a.id,
                                  label: a.name,
                                }))}
                              />
                            ) : c.field === "TYPE" ? (
                              <Select
                                id={valueId}
                                aria-label={`Condition ${i + 1} type`}
                                value={c.value}
                                onChange={(e) => setValue(`conditions.${i}.value`, e.target.value, { shouldDirty: true })}
                                options={CONDITION_TRANSACTION_TYPES.map((t) => ({
                                  value: t,
                                  label: TRANSACTION_TYPE_LABELS[t],
                                }))}
                              />
                            ) : (
                              <Input
                                id={valueId}
                                aria-label={`Condition ${i + 1} text`}
                                aria-invalid={valueError ? true : undefined}
                                {...register(`conditions.${i}.value`)}
                                maxLength={200}
                                placeholder={c.field === "MERCHANT" ? "e.g. Uber" : "e.g. PAYROLL"}
                                autoComplete="off"
                              />
                            )}
                          </div>
                        </div>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => conditions.remove(i)} aria-label={`Remove condition ${i + 1}`}>
                          <Trash2 />
                        </Button>
                      </div>
                      {valueError ? (
                        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                          {valueError}
                        </p>
                      ) : c.field === "AMOUNT" ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">Compared without the sign, so it works for purchases and deposits.</p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {conditionErrors?.root?.message ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {conditionErrors.root.message}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  conditions.append({
                    field: "MERCHANT",
                    operator: "CONTAINS",
                    value: "",
                  })
                }
                disabled={conditions.fields.length >= MAX_ITEMS}
              >
                <Plus /> Add a condition
              </Button>
            </div>
          </StepCard>
        ) : null}

        {/* THEN */}
        <StepCard step="THEN" title="What it does" description="Actions run in this order.">
          <div className="space-y-3">
            <ol className="space-y-2.5">
              {actions.fields.map((f, i) => {
                const a = values.actions[i] ?? f;
                const cfg = (a.config ?? {}) as Record<string, unknown>;
                const err = actionErrors?.[i];
                const typeError = err?.type?.message;
                const configError = err?.config?.message;
                const allowed = actionTypeSchema.options.filter((t) => ACTION_TRIGGERS[t].includes(trigger) || t === a.type);
                const info = ACTION_INFO[a.type];
                const setCfg = (patch: Record<string, unknown>) => setValue(`actions.${i}.config`, { ...cfg, ...patch }, { shouldDirty: true });
                const goalSelect = (
                  <Field label="Goal" error={configError && !cfg.goalId ? configError : undefined}>
                    <Select
                      value={String(cfg.goalId ?? "")}
                      onChange={(e) => setCfg({ goalId: e.target.value || undefined })}
                      placeholder={activeGoals.length ? "Choose a goal" : "No goals yet"}
                    >
                      {options.goals
                        .filter((g) => g.status === "ACTIVE" || g.id === cfg.goalId)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </Select>
                  </Field>
                );
                return (
                  <li key={f.id} className="rounded-lg border border-border bg-subtle p-3">
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-card text-[11px] font-semibold text-muted-foreground ring-1 ring-border"
                        aria-hidden
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div>
                          <Select
                            aria-label={`Action ${i + 1}`}
                            aria-invalid={typeError ? true : undefined}
                            value={a.type}
                            onChange={(e) => {
                              const type = e.target.value as ActionType;
                              setValue(
                                `actions.${i}`,
                                {
                                  type,
                                  config: defaultConfig(type, trigger, options.goals),
                                },
                                { shouldDirty: true },
                              );
                            }}
                            options={allowed.map((t) => ({
                              value: t,
                              label: ACTION_INFO[t].label,
                            }))}
                          />
                          {typeError ? (
                            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                              {typeError}
                            </p>
                          ) : (
                            <p className="mt-1.5 text-xs text-muted-foreground">{info?.description}</p>
                          )}
                        </div>

                        {a.type === "SET_CATEGORY" ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Category" error={configError}>
                              <CategorySelect
                                categories={options.categories}
                                value={String(cfg.categoryId ?? "")}
                                onChange={(id) =>
                                  setCfg({
                                    categoryId: id || undefined,
                                    subcategoryId: null,
                                  })
                                }
                              />
                            </Field>
                            {(() => {
                              const subs = options.categories.find((c) => c.id === cfg.categoryId)?.subcategories ?? [];
                              return subs.length ? (
                                <Field label="Subcategory" hint="Optional">
                                  <Select
                                    value={String(cfg.subcategoryId ?? "")}
                                    onChange={(e) =>
                                      setCfg({
                                        subcategoryId: e.target.value || null,
                                      })
                                    }
                                    placeholder="None"
                                    options={subs.map((s) => ({
                                      value: s.id,
                                      label: s.name,
                                    }))}
                                  />
                                </Field>
                              ) : null;
                            })()}
                          </div>
                        ) : null}
                        {a.type === "ADD_TAG" ? (
                          <Field label="Tag" error={configError}>
                            <Input
                              value={String(cfg.tagName ?? "")}
                              onChange={(e) => setCfg({ tagName: e.target.value })}
                              maxLength={40}
                              placeholder="e.g. Work expense"
                              autoComplete="off"
                            />
                          </Field>
                        ) : null}
                        {a.type === "SET_NOTE" ? (
                          <Field label="Note" error={configError}>
                            <Input
                              value={String(cfg.note ?? "")}
                              onChange={(e) => setCfg({ note: e.target.value })}
                              maxLength={500}
                              placeholder="e.g. Claim from work"
                              autoComplete="off"
                            />
                          </Field>
                        ) : null}
                        {a.type === "RENAME_MERCHANT" ? (
                          <Field label="Show the merchant as" error={configError}>
                            <Input
                              value={String(cfg.merchantName ?? "")}
                              onChange={(e) => setCfg({ merchantName: e.target.value })}
                              maxLength={80}
                              placeholder="e.g. Uber"
                              autoComplete="off"
                            />
                          </Field>
                        ) : null}
                        {a.type === "NOTIFY" ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Title" error={configError}>
                              <Input
                                value={String(cfg.title ?? "")}
                                onChange={(e) => setCfg({ title: e.target.value })}
                                maxLength={100}
                                placeholder="e.g. Big purchase"
                                autoComplete="off"
                              />
                            </Field>
                            <Field label="Message" hint="Optional">
                              <Input
                                value={String(cfg.message ?? "")}
                                onChange={(e) =>
                                  setCfg({
                                    message: e.target.value || undefined,
                                  })
                                }
                                maxLength={300}
                                autoComplete="off"
                              />
                            </Field>
                          </div>
                        ) : null}
                        {a.type === "ALLOCATE_TO_GOAL" ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              {goalSelect}
                              {SCHEDULE_TRIGGERS.includes(trigger) ? (
                                <Field label="Amount each time" error={configError && cfg.goalId ? configError : undefined}>
                                  <CurrencyInput
                                    value={typeof cfg.amountCents === "number" ? cfg.amountCents : null}
                                    onChange={(c) =>
                                      setCfg({
                                        amountCents: c ?? undefined,
                                        percentBps: undefined,
                                      })
                                    }
                                    currency={fmt.currency}
                                    locale={fmt.locale}
                                    placeholder="0.00"
                                  />
                                </Field>
                              ) : (
                                <div className="flex min-w-0 flex-col gap-1.5">
                                  <span className="text-[13px] font-medium leading-none text-foreground">How much</span>
                                  <Segmented
                                    aria-label="Percentage or fixed amount"
                                    size="sm"
                                    value={typeof cfg.amountCents === "number" ? "fixed" : "percent"}
                                    onChange={(v) =>
                                      setCfg(
                                        v === "fixed"
                                          ? {
                                              amountCents: 5000,
                                              percentBps: undefined,
                                            }
                                          : {
                                              percentBps: 1000,
                                              amountCents: undefined,
                                            },
                                      )
                                    }
                                    options={[
                                      {
                                        value: "percent",
                                        label: "A percentage",
                                      },
                                      {
                                        value: "fixed",
                                        label: "A fixed amount",
                                      },
                                    ]}
                                  />
                                </div>
                              )}
                            </div>
                            {!SCHEDULE_TRIGGERS.includes(trigger) ? (
                              <div className="grid gap-3 sm:grid-cols-2">
                                {typeof cfg.amountCents === "number" ? (
                                  <Field label="Amount" error={configError && cfg.goalId ? configError : undefined} hint="Capped at the transaction's amount.">
                                    <CurrencyInput
                                      value={cfg.amountCents}
                                      onChange={(c) => setCfg({ amountCents: c ?? undefined })}
                                      currency={fmt.currency}
                                      locale={fmt.locale}
                                      placeholder="0.00"
                                    />
                                  </Field>
                                ) : (
                                  <Field
                                    label={`Percentage of the ${trigger === "INCOME_RECEIVED" ? "income" : "amount"}`}
                                    error={configError && cfg.goalId ? configError : undefined}
                                  >
                                    <PercentInput value={typeof cfg.percentBps === "number" ? cfg.percentBps : undefined} onChange={(bps) => setCfg({ percentBps: bps })} />
                                  </Field>
                                )}
                                <Field label="Only the part above" hint="Optional. Leave empty to use the whole amount.">
                                  <CurrencyInput
                                    value={typeof cfg.aboveCents === "number" && cfg.aboveCents > 0 ? cfg.aboveCents : null}
                                    onChange={(c) =>
                                      setCfg({
                                        aboveCents: c && c > 0 ? c : undefined,
                                      })
                                    }
                                    currency={fmt.currency}
                                    locale={fmt.locale}
                                    placeholder="0.00"
                                  />
                                </Field>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {a.type === "ROUND_UP_TO_GOAL" ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {goalSelect}
                            <div className="flex min-w-0 flex-col gap-1.5">
                              <span className="text-[13px] font-medium leading-none text-foreground">Round up to the next</span>
                              <Segmented
                                aria-label="Round up to the next"
                                size="sm"
                                value={String(cfg.roundToCents ?? 100)}
                                onChange={(v) => setCfg({ roundToCents: Number(v) })}
                                options={ROUND_UP_CHOICES.map((c) => ({
                                  value: String(c),
                                  label: fmt.money(c, { hideZeroCents: true }),
                                }))}
                              />
                            </div>
                          </div>
                        ) : null}
                        {info?.plansMoney ? (
                          <p className="flex items-start gap-1.5 text-xs text-info">
                            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                            <span>Recorded as a planned allocation on the goal. No money is moved: transfer it at your bank when you&apos;re ready.</span>
                          </p>
                        ) : null}
                        {info?.plansMoney && !activeGoals.length ? (
                          <p className="text-xs text-muted-foreground">
                            You don&apos;t have an active goal yet.{" "}
                            <Link href="/goals" className="font-medium text-primary underline-offset-4 hover:underline">
                              Create one in Goals
                            </Link>{" "}
                            first.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => actions.move(i, i - 1)} disabled={i === 0} aria-label={`Move action ${i + 1} up`}>
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => actions.move(i, i + 1)}
                          disabled={i === actions.fields.length - 1}
                          aria-label={`Move action ${i + 1} down`}
                        >
                          <ArrowDown />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => actions.remove(i)} aria-label={`Remove action ${i + 1}`}>
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {actionErrors?.root?.message ? (
              <p role="alert" className="text-xs font-medium text-danger">
                {actionErrors.root.message}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const type = (txnTrigger ? "SET_CATEGORY" : SCHEDULE_TRIGGERS.includes(trigger) ? "ALLOCATE_TO_GOAL" : "NOTIFY") as ActionType;
                actions.append({
                  type,
                  config: defaultConfig(type, trigger, options.goals),
                });
              }}
              disabled={actions.fields.length >= MAX_ITEMS}
            >
              <Plus /> Add an action
            </Button>
          </div>
        </StepCard>
      </div>

      {/* Summary & dry run */}
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <section aria-labelledby="summary-title" className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <h2 id="summary-title" className="text-sm font-semibold text-foreground">
            In plain words
          </h2>
          <AutomationSentence automation={values} ctx={ctx} className="mt-3" />
          {plans ? (
            <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-xs text-foreground">Goal amounts are planned allocations. Harbour never moves money between accounts.</p>
          ) : null}
        </section>
        <section aria-labelledby="preview-title" className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="preview-title" className="text-sm font-semibold text-foreground">
                Try it on the last 90 days
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">A dry run: nothing is changed.</p>
            </div>
            <Button type="button" size="sm" variant={preview ? "outline" : "primary"} onClick={runPreview} loading={previewing}>
              {previewing ? null : preview ? <RefreshCw /> : <FlaskConical />} {preview ? "Again" : "Preview"}
            </Button>
          </div>
          {previewError ? (
            <p role="alert" className="mt-3 text-xs font-medium text-danger">
              {previewError}
            </p>
          ) : null}
          {preview ? (
            <div className="mt-3" aria-live="polite">
              {preview.signature !== signature ? <p className="mb-2 text-xs font-medium text-warning">You changed the automation since this preview.</p> : null}
              <PreviewPanel preview={preview.data} />
            </div>
          ) : null}
        </section>
      </aside>

      <div
        className={cn(
          "flex flex-col-reverse gap-3 rounded-xl border border-border bg-card p-4 shadow-soft sm:flex-row sm:items-center sm:p-5 lg:col-start-1 lg:row-start-2",
          automationId ? "sm:justify-end" : "sm:justify-between",
        )}
      >
        {automationId ? null : (
          <label className="flex items-center gap-3 text-sm text-foreground" htmlFor="automation-active">
            <Controller control={control} name="isActive" render={({ field }) => <Switch id="automation-active" checked={field.value} onCheckedChange={field.onChange} />} />
            <span>
              <span className="font-medium">Turn on when saved</span>
              <span className="block text-xs text-muted-foreground">{values.isActive ? "Runs on new activity from now on." : "Saved but won't run until you turn it on."}</span>
            </span>
          </label>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/automations")} disabled={submitting} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button type="submit" loading={submitting} className="flex-1 sm:flex-none">
            {automationId ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </div>
    </form>
  );
}
