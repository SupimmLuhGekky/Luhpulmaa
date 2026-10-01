import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Logo } from "@/components/shared/logo";
import { ONBOARDING_STEP_COUNT, ONBOARDING_STEPS, onboardingStepHref } from "@/lib/users/onboarding-plan";
import { signOutAction } from "@/app/actions/auth";
import { cn } from "@/lib/utils";
import { SkipSetupButton } from "./skip-setup-button";

/**
 * Setup chrome: a slim header, the list of steps (desktop) or a progress bar (phones),
 * and the current step in a card. Steps up to the furthest one reached can be revisited.
 */
export function OnboardingFrame({ step, furthest, children }: { step: number; furthest: number; children: React.ReactNode }) {
  const last = step === ONBOARDING_STEP_COUNT;
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1">
            {last ? null : <SkipSetupButton />}
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        <Progress value={(step / ONBOARDING_STEP_COUNT) * 100} size="sm" label={`Setup: step ${step} of ${ONBOARDING_STEP_COUNT}`} className="rounded-none lg:hidden" />
      </header>
      <main id="main" className="mx-auto grid w-full max-w-5xl flex-1 items-start gap-8 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <nav aria-label="Setup steps" className="sticky top-24 hidden lg:block">
          <ol className="space-y-0.5">
            {ONBOARDING_STEPS.map((s, i) => {
              const n = i + 1;
              const current = n === step;
              const done = n < furthest && !current;
              const reachable = n <= furthest && !current;
              const inner = (
                <>
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular",
                      current ? "border-primary bg-primary text-primary-foreground" : done ? "border-positive/30 bg-positive-soft text-positive" : "border-border bg-card text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {s.optional ? <span className="text-[11px] text-muted-foreground">Optional</span> : null}
                  {done ? <span className="sr-only">(done)</span> : null}
                </>
              );
              const cls = cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]", current ? "bg-card font-medium text-foreground shadow-soft ring-1 ring-border" : reachable ? "text-foreground" : "text-muted-foreground");
              return (
                <li key={s.key}>
                  {reachable ? (
                    <Link href={onboardingStepHref(n)} className={cn(cls, "transition-colors hover:bg-muted")}>
                      {inner}
                    </Link>
                  ) : (
                    <div className={cls} aria-current={current ? "step" : undefined}>
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-4 px-2.5 text-xs leading-relaxed text-muted-foreground">Each step is saved as you go. You can leave and pick up where you left off.</p>
        </nav>
        <section className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-8">{children}</section>
      </main>
    </>
  );
}
