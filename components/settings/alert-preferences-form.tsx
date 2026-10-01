"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { updatePreferencesAction } from "@/app/actions/settings";
import { SettingRow, SettingRows, SettingsSection } from "./settings-ui";

const REMINDER_DAYS = [0, 1, 2, 3, 5, 7, 10, 14];

function reminderLabel(days: number) {
  if (days === 0) return "On the due date";
  return `${days} ${days === 1 ? "day" : "days"} before`;
}

export function AlertPreferencesForm({ initial, budgetThresholds }: { initial: { largeTransactionCents: number; billReminderDays: number }; budgetThresholds: number[] }) {
  const router = useRouter();
  const fmt = useFormat();
  const [largeOn, setLargeOn] = React.useState(initial.largeTransactionCents > 0);
  const [large, setLarge] = React.useState<number | null>(initial.largeTransactionCents > 0 ? initial.largeTransactionCents : 50000);
  const [billDays, setBillDays] = React.useState(initial.billReminderDays);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const largeValue = largeOn ? (large ?? 0) : 0;
  const dirty = largeValue !== initial.largeTransactionCents || billDays !== initial.billReminderDays;
  const dayOptions = REMINDER_DAYS.includes(billDays) ? REMINDER_DAYS : [...REMINDER_DAYS, billDays].sort((a, b) => a - b);

  const save = async () => {
    if (largeOn && (!large || large < 100)) {
      setError("Enter an amount of at least $1, or turn large-transaction alerts off.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updatePreferencesAction({ largeTransactionCents: largeValue, billReminderDays: billDays });
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Alert settings saved");
    router.refresh();
  };

  return (
    <SettingsSection
      id="alert-rules"
      title="When to alert you"
      description="What counts as worth a notification."
      footer={
        <Button onClick={save} loading={saving} disabled={!dirty}>
          Save changes
        </Button>
      }
    >
      <FormError message={error} />
      <SettingRows>
        <div className="py-3.5 first:pt-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <label htmlFor="large-on" className="text-sm font-medium text-foreground">
                Large transactions
              </label>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Tell me about any purchase or withdrawal at or above an amount.</p>
            </div>
            <Switch id="large-on" checked={largeOn} onCheckedChange={setLargeOn} />
          </div>
          {largeOn ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="large-amount" className="text-[13px] text-muted-foreground">
                At or above
              </label>
              <CurrencyInput id="large-amount" value={large} onChange={setLarge} currency={fmt.currency} locale={fmt.locale} className="w-full sm:w-40" />
            </div>
          ) : null}
        </div>
        <SettingRow label="Bill reminders" description="Default reminder for bills you add. Each bill can have its own." htmlFor="bill-days">
          <Select id="bill-days" value={String(billDays)} onChange={(e) => setBillDays(Number(e.target.value))} className="w-full sm:w-48" options={dayOptions.map((d) => ({ value: String(d), label: reminderLabel(d) }))} />
        </SettingRow>
        <div className="py-3.5 last:pb-0">
          <p className="text-sm font-medium text-foreground">Budget alerts</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {budgetThresholds.length ? `New budget lines alert you at ${budgetThresholds.map((t) => `${t}%`).join(", ")} of their amount.` : "New budget lines don't have alerts."}{" "}
            <Link href="/settings/budget" className="font-medium text-primary underline-offset-4 hover:underline">
              Change in Budget settings
            </Link>
          </p>
        </div>
      </SettingRows>
    </SettingsSection>
  );
}
