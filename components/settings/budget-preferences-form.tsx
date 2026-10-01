"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { updatePlanningAction, updatePreferencesAction } from "@/app/actions/settings";
import { SettingRow, SettingRows, SettingsSection } from "./settings-ui";

const SUGGESTED_THRESHOLDS = [50, 75, 80, 90, 100];
const MAX_THRESHOLDS = 6;

export interface BudgetPreferencesProps {
  initial: {
    budgetAlertThresholds: number[];
    budgetRolloverDefault: boolean;
    budgetMode: "STANDARD" | "ZERO_BASED";
    monthlyIncomeTargetCents: number | null;
    minCashBufferCents: number;
    includeSavingsInSafeToSpend: boolean;
  };
}

function sameList(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function BudgetPreferencesForm({ initial }: BudgetPreferencesProps) {
  const router = useRouter();
  const fmt = useFormat();

  // Budget defaults
  const [thresholds, setThresholds] = React.useState<number[]>([...initial.budgetAlertThresholds].sort((a, b) => a - b));
  const [rollover, setRollover] = React.useState(initial.budgetRolloverDefault);
  const [mode, setMode] = React.useState(initial.budgetMode);
  const [income, setIncome] = React.useState<number | null>(initial.monthlyIncomeTargetCents);
  const [custom, setCustom] = React.useState("");
  const [customError, setCustomError] = React.useState<string | null>(null);
  const [savingDefaults, setSavingDefaults] = React.useState(false);
  const [defaultsError, setDefaultsError] = React.useState<string | null>(null);

  // Safe to spend
  const [buffer, setBuffer] = React.useState<number | null>(initial.minCashBufferCents);
  const [includeSavings, setIncludeSavings] = React.useState(initial.includeSavingsInSafeToSpend);
  const [savingSafe, setSavingSafe] = React.useState(false);
  const [safeError, setSafeError] = React.useState<string | null>(null);

  const defaultsDirty =
    !sameList(thresholds, [...initial.budgetAlertThresholds].sort((a, b) => a - b)) || rollover !== initial.budgetRolloverDefault || mode !== initial.budgetMode || income !== initial.monthlyIncomeTargetCents;
  const safeDirty = buffer !== initial.minCashBufferCents || includeSavings !== initial.includeSavingsInSafeToSpend;

  const toggleThreshold = (t: number) => {
    setThresholds((list) => (list.includes(t) ? list.filter((x) => x !== t) : list.length >= MAX_THRESHOLDS ? list : [...list, t].sort((a, b) => a - b)));
  };

  const addCustom = () => {
    const n = Number(custom);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      setCustomError("Enter a whole number from 1 to 200.");
      return;
    }
    if (thresholds.includes(n)) {
      setCustomError(`${n}% is already in the list.`);
      return;
    }
    if (thresholds.length >= MAX_THRESHOLDS) {
      setCustomError(`Use at most ${MAX_THRESHOLDS} alerts.`);
      return;
    }
    setThresholds([...thresholds, n].sort((a, b) => a - b));
    setCustom("");
    setCustomError(null);
  };

  const saveDefaults = async () => {
    setSavingDefaults(true);
    setDefaultsError(null);
    const [prefs, planning] = await Promise.all([
      updatePreferencesAction({ budgetAlertThresholds: thresholds, budgetRolloverDefault: rollover }),
      updatePlanningAction({ budgetMode: mode, monthlyIncomeTargetCents: income }),
    ]);
    setSavingDefaults(false);
    const failed = !prefs.ok ? prefs.error.message : !planning.ok ? planning.error.message : null;
    if (failed) {
      setDefaultsError(failed);
      return;
    }
    toast.success("Budget defaults saved", { description: "They apply to budget lines you create from now on." });
    router.refresh();
  };

  const saveSafe = async () => {
    if (buffer === null) {
      setSafeError("Enter a cash buffer (it can be $0).");
      return;
    }
    setSavingSafe(true);
    setSafeError(null);
    const [prefs, planning] = await Promise.all([updatePreferencesAction({ includeSavingsInSafeToSpend: includeSavings }), updatePlanningAction({ minCashBufferCents: buffer })]);
    setSavingSafe(false);
    const failed = !prefs.ok ? prefs.error.message : !planning.ok ? planning.error.message : null;
    if (failed) {
      setSafeError(failed);
      return;
    }
    toast.success("Safe-to-spend settings saved");
    router.refresh();
  };

  const extraThresholds = thresholds.filter((t) => !SUGGESTED_THRESHOLDS.includes(t));

  return (
    <div className="space-y-6">
      <SettingsSection
        id="budget-defaults"
        title="Budget defaults"
        description="Used when you add a new budget line or start a new budget. Existing lines keep their own settings."
        footer={
          <Button onClick={saveDefaults} loading={savingDefaults} disabled={!defaultsDirty}>
            Save changes
          </Button>
        }
      >
        <FormError message={defaultsError} />
        <SettingRows>
          <div className="py-3.5 first:pt-0">
            <p className="text-sm font-medium text-foreground" id="thresholds-label">
              Alert me when a category reaches
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Percentages of the budgeted amount. Above 100% means overspent.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-labelledby="thresholds-label">
              {[...SUGGESTED_THRESHOLDS, ...extraThresholds].map((t) => {
                const on = thresholds.includes(t);
                const isExtra = !SUGGESTED_THRESHOLDS.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleThreshold(t)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] font-medium tabular transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      on ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t}%{isExtra && on ? <X className="size-3" aria-label="remove" /> : null}
                  </button>
                );
              })}
              <div className="flex items-center gap-1.5">
                <Input
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value.replace(/\D/g, "").slice(0, 3));
                    setCustomError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                  inputMode="numeric"
                  placeholder="Other %"
                  aria-label="Add another alert percentage"
                  aria-invalid={customError ? true : undefined}
                  className="h-8 w-24"
                />
                <Button type="button" variant="outline" size="icon-sm" onClick={addCustom} aria-label="Add alert percentage" disabled={!custom}>
                  <Plus />
                </Button>
              </div>
            </div>
            {customError ? (
              <p role="alert" className="mt-2 text-xs font-medium text-danger">
                {customError}
              </p>
            ) : thresholds.length === 0 ? (
              <p className="mt-2 text-xs text-warning">No alerts: you won&apos;t be notified as new budget lines fill up.</p>
            ) : null}
          </div>
          <SettingRow label="Carry over unspent money" description="New budget lines roll what's left into next month (and overspending out of it)." htmlFor="rollover-default" inline>
            <Switch id="rollover-default" checked={rollover} onCheckedChange={setRollover} />
          </SettingRow>
          <SettingRow label="Budget style" description={mode === "ZERO_BASED" ? "Zero-based: give every dollar of income a job until nothing is left to assign." : "Standard: set limits for the categories you care about."}>
            <Segmented
              aria-label="Budget style"
              value={mode}
              onChange={setMode}
              size="sm"
              options={[
                { value: "STANDARD", label: "Standard" },
                { value: "ZERO_BASED", label: "Zero-based" },
              ]}
            />
          </SettingRow>
          <SettingRow label="Planned monthly income" description="Starting point for new monthly budgets and percentage-of-income lines. Leave empty to use none." htmlFor="planned-income">
            <CurrencyInput id="planned-income" value={income} onChange={setIncome} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" className="w-full sm:w-44" />
          </SettingRow>
        </SettingRows>
      </SettingsSection>

      <SettingsSection
        id="safe-to-spend"
        title="Safe to spend"
        description="How Harbour estimates what you can spend before your next payday."
        footer={
          <Button onClick={saveSafe} loading={savingSafe} disabled={!safeDirty}>
            Save changes
          </Button>
        }
      >
        <FormError message={safeError} />
        <SettingRows>
          <SettingRow label="Minimum cash buffer" description="Always kept aside: never counted as safe to spend." htmlFor="cash-buffer">
            <CurrencyInput id="cash-buffer" value={buffer} onChange={setBuffer} currency={fmt.currency} locale={fmt.locale} placeholder="0.00" className="w-full sm:w-44" />
          </SettingRow>
          <SettingRow label="Count savings accounts as spendable" description="Off by default, so savings stay out of the safe-to-spend number." htmlFor="include-savings" inline>
            <Switch id="include-savings" checked={includeSavings} onCheckedChange={setIncludeSavings} />
          </SettingRow>
        </SettingRows>
      </SettingsSection>
    </div>
  );
}
