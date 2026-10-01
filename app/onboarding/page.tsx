import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { listAccounts, listConnections, mockInstitutions } from "@/lib/accounts/service";
import { ESSENTIAL_CATEGORY_KEYS } from "@/lib/categories/defaults";
import { listCategories } from "@/lib/categories/service";
import { COMMON_TIME_ZONES, formatMonthKey, monthKey, todayIn } from "@/lib/dates";
import { isEnabled } from "@/lib/flags";
import { channelAvailability } from "@/lib/notifications/channels";
import { listPreferences } from "@/lib/notifications/service";
import { LOCALE_OPTIONS, timeZoneLabel } from "@/lib/settings/options";
import { userPreferences } from "@/lib/settings/preferences";
import { activeGoalSummaries, averageMonthlySpending, currentMonthBudget, onboardingIntegrations, onboardingState, onboardingSummary, primaryIncome } from "@/lib/users/onboarding";
import { essentialMonthlyCents, resolveStep, stepKey, stepNumber, suggestBudget, suggestGoals } from "@/lib/users/onboarding-plan";
import { CANADIAN_PROVINCES, getProfile } from "@/lib/users/service";
import { FormatProvider } from "@/components/providers/format-provider";
import { OnboardingFrame } from "@/components/onboarding/onboarding-frame";
import { WelcomeStep } from "@/components/onboarding/welcome-step";
import { ProfileStep } from "@/components/onboarding/profile-step";
import { AppGoalsStep } from "@/components/onboarding/app-goals-step";
import { IncomeStep } from "@/components/onboarding/income-step";
import { AccountsStep } from "@/components/onboarding/accounts-step";
import { BudgetStep } from "@/components/onboarding/budget-step";
import { GoalStep } from "@/components/onboarding/goal-step";
import { NotificationsStep } from "@/components/onboarding/notifications-step";
import { DoneStep } from "@/components/onboarding/done-step";

export const dynamic = "force-dynamic";

const HISTORY_MONTHS = 3;

/**
 * Nine-step setup. `?step=` revisits an earlier step; without it (or past the furthest
 * step reached) the person resumes where they left off. Each step loads only its own data.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string | string[] }> }) {
  const user = await requireUser();
  const state = await onboardingState(user.id);
  if (state.completedAt) redirect("/dashboard");
  const { step: requested } = await searchParams;
  const step = resolveStep(requested, state.furthest);
  const today = todayIn(user.timeZone);

  let content: React.ReactNode;
  switch (stepKey(step)) {
    case "welcome":
      content = <WelcomeStep firstName={user.firstName} />;
      break;
    case "profile": {
      const profile = await getProfile(user.id);
      content = (
        <ProfileStep
          step={step}
          initial={{ firstName: profile.firstName, lastName: profile.lastName, province: profile.province, locale: profile.locale, timeZone: profile.timeZone }}
          provinces={CANADIAN_PROVINCES.map((p) => ({ code: p.code, name: p.name }))}
          timeZones={[...COMMON_TIME_ZONES]}
          today={today}
        />
      );
      break;
    }
    case "goals": {
      const prefs = await userPreferences(user.id);
      content = <AppGoalsStep step={step} initial={prefs.appGoals} />;
      break;
    }
    case "income": {
      const income = await primaryIncome(user.id);
      content = <IncomeStep step={step} initial={income} />;
      break;
    }
    case "accounts": {
      const integrations = onboardingIntegrations();
      const [accounts, connections] = await Promise.all([listAccounts(user.id), integrations.demoBank ? listConnections(user.id) : Promise.resolve([])]);
      const demoInstitutions = integrations.demoBank
        ? mockInstitutions()
            // The always-failing test bank is for trying error handling on the Accounts page, not for setup.
            .filter((i) => i.id !== "mock_error")
            .map((i) => ({ id: i.id, name: i.name, color: i.color, connected: connections.some((c) => c.provider === "MOCK" && c.institution === i.name && c.status !== "DISCONNECTED") }))
        : [];
      content = (
        <AccountsStep
          step={step}
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, institution: a.institution?.name ?? null, balanceCents: a.currentBalanceCents, isSimulated: a.isSimulated }))}
          integrations={integrations}
          demoInstitutions={demoInstitutions}
        />
      );
      break;
    }
    case "budget": {
      const [existing, profile, categories, averages] = await Promise.all([
        currentMonthBudget(user.id, user.timeZone),
        getProfile(user.id),
        listCategories(user.id),
        averageMonthlySpending(user.id, user.timeZone, HISTORY_MONTHS),
      ]);
      const suggestion = suggestBudget({ monthlyIncomeCents: profile.monthlyIncomeTargetCents, categories, averageSpending: averages });
      content = (
        <BudgetStep
          step={step}
          monthLabel={formatMonthKey(monthKey(today), user.locale)}
          monthlyIncomeCents={profile.monthlyIncomeTargetCents}
          suggestion={{ basis: suggestion.basis, lines: suggestion.lines, historyMonths: HISTORY_MONTHS }}
          categories={categories
            .filter((c) => c.kind === "EXPENSE" && !c.isHidden)
            .map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, essential: Boolean(c.systemKey && ESSENTIAL_CATEGORY_KEYS.has(c.systemKey)) }))}
          existing={existing ? { lines: existing.lines.length, totalCents: existing.totalCents } : null}
          incomeStep={stepNumber("income")}
        />
      );
      break;
    }
    case "goal": {
      const [budget, goals] = await Promise.all([
        currentMonthBudget(user.id, user.timeZone),
        activeGoalSummaries(user.id),
      ]);
      const essentials = budget ? essentialMonthlyCents(budget.lines) : null;
      content = <GoalStep step={step} suggestions={suggestGoals({ essentialMonthlyCents: essentials })} existingGoals={goals} />;
      break;
    }
    case "notifications": {
      const rows = await listPreferences(user.id);
      const email = channelAvailability().email;
      content = (
        <NotificationsStep
          step={step}
          rows={rows.map((r) => ({ type: r.type, label: r.label, description: r.description, inApp: r.inApp, email: r.email, inAppLocked: r.inAppLocked }))}
          email={{ available: email.available, note: email.note }}
        />
      );
      break;
    }
    case "done": {
      const [profile, summary] = await Promise.all([getProfile(user.id), onboardingSummary(user.id, user.timeZone)]);
      const integrations = onboardingIntegrations();
      content = (
        <DoneStep
          step={step}
          firstName={profile.firstName}
          profile={{
            region: CANADIAN_PROVINCES.find((p) => p.code === profile.province)?.name ?? (profile.country === "US" ? "United States" : "Canada"),
            formatting: LOCALE_OPTIONS.find((l) => l.value === profile.locale)?.label ?? profile.locale,
            timeZone: timeZoneLabel(profile.timeZone),
          }}
          summary={summary}
          next={{ csvImport: integrations.csvImport, realBank: integrations.realBank, providerName: integrations.providerName, automations: isEnabled("ENABLE_AUTOMATIONS") }}
          steps={{ profile: stepNumber("profile"), income: stepNumber("income"), accounts: stepNumber("accounts"), budget: stepNumber("budget"), goal: stepNumber("goal") }}
        />
      );
      break;
    }
  }

  return (
    // In the page rather than the layout, so a new language or time zone applies on the next step.
    <FormatProvider value={{ currency: user.currency, locale: user.locale, timeZone: user.timeZone, today }}>
      <OnboardingFrame step={step} furthest={state.furthest}>
        {content}
      </OnboardingFrame>
    </FormatProvider>
  );
}
