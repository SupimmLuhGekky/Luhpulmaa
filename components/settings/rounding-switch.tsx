"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { updatePreferencesAction } from "@/app/actions/settings";
import { useFormat } from "@/components/providers/format-provider";
import { SettingRow } from "./settings-ui";

/** Whole-dollar headline figures on the dashboard. Saved as soon as it changes. */
export function RoundingSwitch({ initial }: { initial: boolean }) {
  const router = useRouter();
  const fmt = useFormat();
  const [on, setOn] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  const change = async (value: boolean) => {
    setOn(value);
    setSaving(true);
    const res = await updatePreferencesAction({ roundOverviewAmounts: value });
    setSaving(false);
    if (!res.ok) {
      setOn(!value);
      toast.error("Couldn't change rounding", { description: res.error.message });
      return;
    }
    toast.success(value ? "Dashboard figures rounded to whole dollars" : "Dashboard figures show cents");
    router.refresh();
  };

  return (
    <SettingRow
      label="Round dashboard figures to whole dollars"
      description={`Headline amounts like safe to spend and net worth show as ${fmt.money(123_457, { wholeDollars: true })} instead of ${fmt.money(123_456)}. Transactions always show cents.`}
      htmlFor="round-overview"
      inline
    >
      <Switch id="round-overview" checked={on} onCheckedChange={change} disabled={saving} />
    </SettingRow>
  );
}
