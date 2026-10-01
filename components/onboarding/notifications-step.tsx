"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { saveOnboardingNotificationsAction } from "@/app/actions/onboarding";
import { StepFooter, StepHeader, useStepNavigation } from "./step-ui";

type NotificationType = "BUDGET_WARNING" | "GOAL_PROGRESS" | "GOAL_DEADLINE" | "UPCOMING_BILL" | "SUBSCRIPTION" | "LARGE_TRANSACTION" | "SYNC_FAILURE" | "PAYDAY" | "AUTOMATION" | "SYSTEM";

export interface NotificationsStepProps {
  step: number;
  rows: { type: NotificationType; label: string; description: string; inApp: boolean; email: boolean; inAppLocked: boolean }[];
  email: { available: boolean; note?: string };
}

export function NotificationsStep({ step, rows: initial, email }: NotificationsStepProps) {
  const nav = useStepNavigation(step);
  const [rows, setRows] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (type: NotificationType, key: "inApp" | "email", value: boolean) => setRows((rs) => rs.map((r) => (r.type === type ? { ...r, [key]: value } : r)));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await saveOnboardingNotificationsAction({
      preferences: rows.map((r) => ({ type: r.type, inApp: r.inAppLocked || r.inApp, ...(email.available ? { email: r.email } : {}) })),
    });
    if (!res.ok) {
      setPending(false);
      setError(res.error.message);
      return;
    }
    nav.goTo(res.data.next);
  };

  return (
    <>
      <StepHeader
        step={step}
        title="What should Harbour tell you about?"
        description="Notifications appear in Harbour's notification centre. You can fine-tune them, and the alert thresholds, any time in Settings."
      />
      <form id="onboarding-notifications" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <div className="rounded-xl border border-border">
          <div className="flex items-center gap-3 border-b border-border px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="flex-1">Notification</span>
            <span className="w-12 text-center">In app</span>
            <span className="w-12 text-center">Email</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.type} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {r.label}
                    {r.inAppLocked ? <Lock className="size-3 text-muted-foreground" aria-hidden /> : null}
                  </p>
                  <p className="text-xs leading-snug text-muted-foreground">{r.description}</p>
                </div>
                <span className="flex w-12 justify-center">
                  <Switch
                    checked={r.inAppLocked || r.inApp}
                    disabled={r.inAppLocked || pending}
                    onCheckedChange={(v) => set(r.type, "inApp", v)}
                    aria-label={`${r.label} in the app${r.inAppLocked ? " (always on)" : ""}`}
                  />
                </span>
                <span className="flex w-12 justify-center">
                  <Switch
                    checked={email.available && r.email}
                    disabled={!email.available || pending}
                    onCheckedChange={(v) => set(r.type, "email", v)}
                    aria-label={`${r.label} by email${email.available ? "" : " (unavailable)"}`}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
        {!email.available ? <Notice tone="neutral">{email.note ?? "Email isn't available here."}</Notice> : email.note ? <Notice tone="neutral">{email.note}</Notice> : null}
        {rows.some((r) => r.inAppLocked) ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden /> Account and security messages always appear in Harbour.
          </p>
        ) : null}
      </form>
      <StepFooter step={step} formId="onboarding-notifications" submitLabel="Save and continue" pending={pending} onSkip={nav.advance} skipping={nav.skipping} />
    </>
  );
}
