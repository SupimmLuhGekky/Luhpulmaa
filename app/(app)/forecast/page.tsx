import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { cashFlowForecast, safeToSpend } from "@/lib/forecast/service";
import { parseHorizon } from "@/lib/forecast/window";
import { ForecastView } from "@/components/forecast/forecast-view";

export const metadata: Metadata = { title: "Cash flow" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ForecastPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await requireOnboardedUser();
  // One 90-day run feeds every horizon (7/30/60/90) on the client: see lib/forecast/window.
  const [safe, forecast] = await Promise.all([safeToSpend(user.id), cashFlowForecast(user.id, 90)]);
  const incomes = forecast.upcoming.filter((e) => e.kind === "income");
  const payday = incomes.find((e) => e.date === safe.nextPayday) ?? incomes[0] ?? null;

  return (
    <ForecastView
      safe={safe}
      base={{ today: forecast.today, startingBalance: forecast.startingBalance, dailyDiscretionary: forecast.dailyDiscretionary, minimumBuffer: forecast.minimumBuffer, upcoming: forecast.upcoming }}
      initialDays={parseHorizon(params.days)}
      nextPayday={payday ? { date: payday.date, amount: payday.amount, label: payday.label } : null}
    />
  );
}
