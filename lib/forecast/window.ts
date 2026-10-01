/**
 * Forecast horizons (pure: used by the /forecast page on the client).
 *
 * cashFlowForecast(userId, 90) contains everything a shorter horizon needs: its
 * scheduled events are generated per day, so the first N days of the 90-day run use
 * exactly the events cashFlowForecast(userId, N) would. forecastWindow re-runs the
 * same calculateCashFlow on that prefix, so switching 7/30/60/90 needs no refetch and
 * gives the same numbers as asking the service for that horizon.
 */
import { addDays, type LocalDate } from "@/lib/dates";
import { calculateCashFlow, type CashFlowEvent } from "@/lib/finance/calculations";
import type { Cents } from "@/lib/finance/money";

export const FORECAST_HORIZONS = [7, 30, 60, 90] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];

export function parseHorizon(value: unknown, fallback: ForecastHorizon = 30): ForecastHorizon {
  const n = Number(value);
  return (FORECAST_HORIZONS as readonly number[]).includes(n) ? (n as ForecastHorizon) : fallback;
}

export interface ForecastBase {
  today: LocalDate;
  startingBalance: Cents;
  dailyDiscretionary: Cents;
  minimumBuffer: Cents;
  /** Scheduled events (income, bills, subscriptions, planned savings), any horizon ≥ the one asked for. */
  upcoming: CashFlowEvent[];
}

export function forecastWindow(base: ForecastBase, days: number) {
  const end = addDays(base.today, days - 1);
  const events = base.upcoming.filter((e) => e.date >= base.today && e.date <= end);
  const flow = calculateCashFlow(base.startingBalance, events, base.today, days, base.dailyDiscretionary);
  return {
    ...flow,
    today: base.today,
    horizonDays: days,
    end,
    dailyDiscretionary: base.dailyDiscretionary,
    minimumBuffer: base.minimumBuffer,
    belowBuffer: flow.days.filter((d) => d.balance < base.minimumBuffer).map((d) => d.date),
    upcoming: events,
  };
}

export type ForecastWindow = ReturnType<typeof forecastWindow>;
