"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ONBOARDING_STEP_COUNT, ONBOARDING_STEPS, onboardingStepHref as stepHref } from "@/lib/users/onboarding-plan";
import { advanceOnboardingAction } from "@/app/actions/onboarding";

/** Moving between steps. The page loads each step's data, so this is plain navigation. */
export function useStepNavigation(step: number) {
  const router = useRouter();
  const [skipping, setSkipping] = React.useState(false);
  // Pending until the next step has rendered, so buttons keep their spinner meanwhile.
  const [navigating, startTransition] = React.useTransition();
  const goTo = React.useCallback((n: number) => startTransition(() => router.push(stepHref(n))), [router]);
  /** Records the step as done without saving anything ("Skip for now", "Continue"). */
  const advance = React.useCallback(async () => {
    setSkipping(true);
    const res = await advanceOnboardingAction({ from: step });
    if (!res.ok) {
      setSkipping(false);
      toast.error(res.error.message);
      return;
    }
    startTransition(() => router.push(stepHref(res.data.next)));
  }, [router, step]);
  return { goTo, advance, skipping, navigating };
}

export function StepHeader({ step, title, description }: { step: number; title: React.ReactNode; description?: React.ReactNode }) {
  const meta = ONBOARDING_STEPS[step - 1];
  return (
    <header className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
        Step {step} of {ONBOARDING_STEP_COUNT}
        {meta?.optional ? <span className="font-medium normal-case tracking-normal text-muted-foreground"> · optional</span> : null}
      </p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground sm:text-[26px]">{title}</h1>
      {description ? <div className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted-foreground">{description}</div> : null}
    </header>
  );
}

/**
 * Back on the left; skip and the main button on the right (stacked full-width on phones,
 * main button first).
 */
export function StepFooter({
  step,
  formId,
  submitLabel = "Continue",
  pending,
  onSkip,
  skipping,
  skipLabel = "Skip for now",
  primary,
}: {
  step: number;
  formId?: string;
  submitLabel?: string;
  pending?: boolean;
  onSkip?: () => void;
  skipping?: boolean;
  skipLabel?: string;
  /** Replaces the submit button. */
  primary?: React.ReactNode;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
      {step > 1 ? (
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <Link href={stepHref(step - 1)}>
            <ChevronLeft /> Back
          </Link>
        </Button>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {onSkip ? (
          <Button type="button" variant="ghost" onClick={onSkip} loading={skipping} disabled={pending} className="w-full sm:w-auto">
            {skipLabel}
          </Button>
        ) : null}
        {primary ?? (
          <Button type="submit" form={formId} loading={pending} disabled={skipping} className="w-full sm:w-auto">
            {submitLabel} {pending ? null : <ArrowRight />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** "0.00", or "0,00" with French formatting. */
export function moneyPlaceholder(locale: string) {
  return locale.startsWith("fr") ? "0,00" : "0.00";
}

/** Applies server field errors (top-level keys) to a react-hook-form instance. */
export function applyFieldErrors<K extends string>(fieldErrors: Record<string, string[]> | undefined, setError: (name: K, error: { message: string }) => void, known: readonly K[]) {
  let applied = false;
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if ((known as readonly string[]).includes(key) && messages[0]) {
      setError(key as K, { message: messages[0] });
      applied = true;
    }
  }
  return applied;
}
