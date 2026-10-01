"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { addDays, addMonths, endOfMonth, startOfMonth, startOfYear, type LocalDate } from "@/lib/dates";
import type { QuickAddOptions } from "@/app/actions/shell";
import { CategoryOptions } from "./category-options";

export interface FilterValues {
  accountId?: string;
  categoryId?: string;
  type?: string;
  tagId?: string;
  from?: string;
  to?: string;
  minCents?: number;
  maxCents?: number;
  pending?: string;
  review?: string;
}

export const TYPE_LABELS: Record<string, string> = { EXPENSE: "Spending", INCOME: "Income", TRANSFER: "Transfers", REFUND: "Refunds", ADJUSTMENT: "Adjustments" };

type Preset = "any" | "this_month" | "last_month" | "last_90" | "this_year" | "custom";

export function datePresetRange(preset: Preset, today: LocalDate): { from?: string; to?: string } {
  switch (preset) {
    case "this_month":
      return { from: startOfMonth(today), to: today };
    case "last_month": {
      const start = addMonths(startOfMonth(today), -1);
      return { from: start, to: endOfMonth(start) };
    }
    case "last_90":
      return { from: addDays(today, -89), to: today };
    case "this_year":
      return { from: startOfYear(today), to: today };
    default:
      return {};
  }
}

function presetFor(from: string | undefined, to: string | undefined, today: LocalDate): Preset {
  if (!from && !to) return "any";
  for (const p of ["this_month", "last_month", "last_90", "this_year"] as const) {
    const r = datePresetRange(p, today);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

/** All narrowing filters in one sheet (works the same on phones and desktops). */
export function FiltersDialog({ value, activeCount, onApply, accounts, categories, tags }: {
  value: FilterValues;
  activeCount: number;
  onApply: (next: FilterValues) => void;
  accounts: { id: string; name: string; mask: string | null }[];
  categories: QuickAddOptions["categories"];
  tags: { id: string; name: string }[];
}) {
  const f = useFormat();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<FilterValues>(value);
  const [preset, setPreset] = React.useState<Preset>("any");

  React.useEffect(() => {
    if (open) {
      setDraft(value);
      setPreset(presetFor(value.from, value.to, f.today));
    }
  }, [open, value, f.today]);

  const set = (patch: Partial<FilterValues>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0" aria-label={activeCount ? `Filters, ${activeCount} active` : "Filters"}>
          <SlidersHorizontal />
          <span className="hidden sm:inline">Filters</span>
          {activeCount ? <Badge variant="primary">{activeCount}</Badge> : null}
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Filter transactions</DialogTitle>
          <DialogDescription>Narrow the list by date, account, category and more.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Dates">
            <Select
              value={preset}
              onChange={(e) => {
                const p = e.target.value as Preset;
                setPreset(p);
                if (p !== "custom") set(datePresetRange(p, f.today));
              }}
              options={[
                { value: "any", label: "Any time" },
                { value: "this_month", label: "This month" },
                { value: "last_month", label: "Last month" },
                { value: "last_90", label: "Last 90 days" },
                { value: "this_year", label: "This year" },
                { value: "custom", label: "Custom range" },
              ]}
            />
          </Field>
          {preset === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <DatePicker value={draft.from ?? null} onChange={(d) => set({ from: d || undefined })} locale={f.locale} max={draft.to ?? f.today} />
              </Field>
              <Field label="To">
                <DatePicker value={draft.to ?? null} onChange={(d) => set({ to: d || undefined })} locale={f.locale} max={f.today} />
              </Field>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account">
              <Select value={draft.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value || undefined })} placeholder="All accounts" options={accounts.map((a) => ({ value: a.id, label: a.mask ? `${a.name} ••${a.mask}` : a.name }))} />
            </Field>
            <Field label="Category">
              <Select value={draft.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || undefined })} placeholder="All categories">
                <option value="uncategorized">Uncategorized</option>
                <CategoryOptions categories={categories} />
              </Select>
            </Field>
            <Field label="Type">
              <Select value={draft.type ?? ""} onChange={(e) => set({ type: e.target.value || undefined })} placeholder="Any type" options={Object.entries(TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            </Field>
            <Field label="Status">
              <Select
                value={draft.pending ?? ""}
                onChange={(e) => set({ pending: e.target.value || undefined })}
                placeholder="Pending and posted"
                options={[
                  { value: "true", label: "Pending only" },
                  { value: "false", label: "Posted only" },
                ]}
              />
            </Field>
            <Field label="Minimum amount">
              <CurrencyInput value={draft.minCents ?? null} onChange={(c) => set({ minCents: c ?? undefined })} currency={f.currency} locale={f.locale} placeholder="Any" />
            </Field>
            <Field label="Maximum amount">
              <CurrencyInput value={draft.maxCents ?? null} onChange={(c) => set({ maxCents: c ?? undefined })} currency={f.currency} locale={f.locale} placeholder="Any" />
            </Field>
            {tags.length ? (
              <Field label="Tag">
                <Select value={draft.tagId ?? ""} onChange={(e) => set({ tagId: e.target.value || undefined })} placeholder="Any tag" options={tags.map((t) => ({ value: t.id, label: t.name }))} />
              </Field>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="filter-review" checked={draft.review === "uncategorized"} onCheckedChange={(c) => set({ review: c === true ? "uncategorized" : undefined })} />
            <Label htmlFor="filter-review" className="font-normal">
              Only transactions that need a category
            </Label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            className="sm:mr-auto"
            onClick={() => {
              setDraft({});
              setPreset("any");
            }}
          >
            Clear all
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            Show results
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
