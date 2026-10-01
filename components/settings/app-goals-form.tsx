"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/shared/field";
import { AppGoalPicker } from "@/components/onboarding/app-goal-picker";
import type { AppGoalKey } from "@/lib/settings/options";
import { updatePreferencesAction } from "@/app/actions/settings";
import { SettingsSection } from "./settings-ui";

/** "What would you like help with?" from setup, editable later. */
export function AppGoalsForm({ initial }: { initial: AppGoalKey[] }) {
  const router = useRouter();
  const [saved, setSaved] = React.useState(initial);
  const [value, setValue] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = value.length !== saved.length || value.some((k) => !saved.includes(k));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await updatePreferencesAction({ appGoals: value });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setSaved(value);
    toast.success("Saved");
    router.refresh();
  };

  return (
    <form onSubmit={save} noValidate>
      <SettingsSection
        id="app-goals"
        title="What you'd like help with"
        description="From setup. Harbour uses it to suggest what to set up next."
        footer={
          <>
            {dirty ? (
              <Button type="button" variant="ghost" onClick={() => setValue(saved)} disabled={pending}>
                Discard
              </Button>
            ) : null}
            <Button type="submit" loading={pending} disabled={!dirty}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormError message={error} />
          <AppGoalPicker value={value} onChange={setValue} disabled={pending} />
        </div>
      </SettingsSection>
    </form>
  );
}
