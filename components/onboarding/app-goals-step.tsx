"use client";

import * as React from "react";
import { FormError } from "@/components/shared/field";
import type { AppGoalKey } from "@/lib/settings/options";
import { saveOnboardingGoalsAction } from "@/app/actions/onboarding";
import { AppGoalPicker } from "./app-goal-picker";
import { StepFooter, StepHeader, useStepNavigation } from "./step-ui";

export function AppGoalsStep({ step, initial }: { step: number; initial: AppGoalKey[] }) {
  const nav = useStepNavigation(step);
  const [value, setValue] = React.useState<AppGoalKey[]>(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await saveOnboardingGoalsAction({ appGoals: value });
    if (!res.ok) {
      setPending(false);
      setError(res.error.message);
      return;
    }
    nav.goTo(res.data.next);
  };

  return (
    <>
      <StepHeader step={step} title="What would you like help with?" description="Pick as many as you like. It shapes what Harbour suggests next, and you can change it later in Settings → Profile." />
      <form id="onboarding-app-goals" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <fieldset>
          <legend className="sr-only">What you&apos;d like help with</legend>
          <AppGoalPicker value={value} onChange={setValue} disabled={pending} />
        </fieldset>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {value.length ? `${value.length} selected` : "Nothing selected yet. That's fine too."}
        </p>
      </form>
      <StepFooter step={step} formId="onboarding-app-goals" pending={pending} />
    </>
  );
}
