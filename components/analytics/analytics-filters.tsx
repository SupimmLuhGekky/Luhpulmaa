"use client";

import * as React from "react";
import { Tags, Wallet } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Segmented } from "@/components/ui/segmented";
import { useFormat } from "@/components/providers/format-provider";
import type { AnalyticsRange } from "@/lib/analytics/range";
import type { LocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { MultiSelectFilter, type FilterGroup } from "./multi-select-filter";

export interface AppliedQuery {
  range: AnalyticsRange;
  /** Resolved dates of the period shown (also for presets). */
  from: LocalDate;
  to: LocalDate;
  accounts: string[];
  categories: string[];
}

export type ParamPatch = Record<string, string | null>;

const RANGE_OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" },
];

/**
 * One row of filters above the charts: period preset or custom dates, accounts and
 * categories. Everything lives in the URL; controls update immediately and the
 * page re-renders with the new figures.
 */
export function AnalyticsFilters({
  applied,
  accountGroups,
  categoryGroups,
  onChange,
  className,
}: {
  applied: AppliedQuery;
  accountGroups: FilterGroup[];
  categoryGroups: FilterGroup[];
  onChange: (patch: ParamPatch) => void;
  className?: string;
}) {
  const fmt = useFormat();
  // Optimistic copy of the period so the controls respond before the new data arrives.
  const [shown, setShown] = React.useState(applied);
  const [base, setBase] = React.useState(applied);
  if (base !== applied) {
    setBase(applied);
    setShown(applied);
  }

  const chooseRange = (range: AnalyticsRange) => {
    if (range === shown.range) return;
    setShown({ ...shown, range });
    // Custom starts from the dates on screen, so switching never jumps elsewhere.
    onChange(range === "custom" ? { range, from: shown.from, to: shown.to } : { range: range === "month" ? null : range, from: null, to: null });
  };

  const chooseDate = (which: "from" | "to", value: LocalDate | null) => {
    if (!value) return;
    let { from, to } = shown;
    if (which === "from") from = value;
    else to = value;
    if (from > to) [from, to] = which === "from" ? [from, from] : [to, to];
    setShown({ ...shown, range: "custom", from, to });
    onChange({ range: "custom", from, to });
  };

  return (
    <div className={cn("flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center", className)} role="group" aria-label="Analytics filters">
      <Segmented<AnalyticsRange> value={shown.range} onChange={chooseRange} options={RANGE_OPTIONS} aria-label="Period" className="w-full sm:w-auto" />
      {shown.range === "custom" ? (
        <div className="grid grid-cols-2 items-center gap-2 sm:flex">
          <DatePicker value={shown.from} onChange={(d) => chooseDate("from", d)} max={fmt.today} locale={fmt.locale} aria-label="Start date" className="sm:w-36" />
          <span className="hidden text-muted-foreground sm:inline" aria-hidden>
            –
          </span>
          <DatePicker value={shown.to} onChange={(d) => chooseDate("to", d)} max={fmt.today} locale={fmt.locale} aria-label="End date" className="sm:w-36" />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <MultiSelectFilter
          label="Accounts"
          allLabel="All accounts"
          noun="accounts"
          icon={Wallet}
          groups={accountGroups}
          selected={applied.accounts}
          onApply={(ids) => onChange({ accounts: ids.length ? ids.join(",") : null })}
          className="sm:w-auto sm:min-w-40 sm:max-w-60"
        />
        <MultiSelectFilter
          label="Categories"
          allLabel="All categories"
          noun="categories"
          icon={Tags}
          groups={categoryGroups}
          selected={applied.categories}
          onApply={(ids) => onChange({ categories: ids.length ? ids.join(",") : null })}
          className="sm:w-auto sm:min-w-40 sm:max-w-60"
        />
      </div>
    </div>
  );
}
