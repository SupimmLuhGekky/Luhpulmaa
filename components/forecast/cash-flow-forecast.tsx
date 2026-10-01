"use client";

import * as React from "react";
import { ArrowDownLeft, PiggyBank, Receipt, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import { relativeDay } from "@/components/bills/day-panel";
import { FORECAST_HORIZONS, forecastWindow, type ForecastBase, type ForecastHorizon } from "@/lib/forecast/window";
import type { CashFlowEvent, CashFlowEventKind } from "@/lib/finance/calculations";
import { cn } from "@/lib/utils";
import { CashFlowChart, CashFlowLegend, FORECAST_COLORS, type ForecastPoint } from "./cash-flow-chart";

const KIND: Record<Exclude<CashFlowEventKind, "expense">, { label: string; icon: typeof Receipt }> = {
  income: { label: "Pay", icon: ArrowDownLeft },
  bill: { label: "Bill", icon: Receipt },
  subscription: { label: "Subscription", icon: Repeat },
  goal: { label: "Planned savings", icon: PiggyBank },
};

const EVENTS_SHOWN = 8;

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: React.ReactNode; tone?: "danger" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("tabular mt-0.5 truncate text-lg font-semibold tracking-tight", tone === "danger" ? "text-danger" : "text-foreground")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Cash-flow forecast for 7, 30, 60 or 90 days. The server sends one 90-day base;
 * shorter horizons are recalculated here with the same calculation (no refetch),
 * and the choice is kept in `?days=`.
 */
export function CashFlowForecast({ base, initialDays }: { base: ForecastBase; initialDays: ForecastHorizon }) {
  const fmt = useFormat();
  const [days, setDays] = React.useState<ForecastHorizon>(initialDays);
  const [showAll, setShowAll] = React.useState(false);
  const w = React.useMemo(() => forecastWindow(base, days), [base, days]);
  const points = React.useMemo<ForecastPoint[]>(
    () =>
      w.days.map((d) => ({
        date: d.date,
        balance: d.balance,
        inflow: d.inflow,
        outflow: d.outflow,
        incoming: d.events.filter((e) => e.kind === "income"),
        outgoing: d.events.filter((e) => e.kind === "bill" || e.kind === "subscription" || e.kind === "goal"),
        typical: d.events.filter((e) => e.kind === "expense").reduce((s, e) => s - e.amount, 0),
      })),
    [w],
  );

  const choose = (d: ForecastHorizon) => {
    setDays(d);
    setShowAll(false);
    const url = new URL(window.location.href);
    if (d === 30) url.searchParams.delete("days");
    else url.searchParams.set("days", String(d));
    window.history.replaceState(window.history.state, "", url);
  };

  const events = w.upcoming;
  const shown = showAll ? events : events.slice(0, EVENTS_SHOWN);
  const groups: [string, CashFlowEvent[]][] = [];
  for (const e of shown) {
    const last = groups[groups.length - 1];
    if (last && last[0] === e.date) last[1].push(e);
    else groups.push([e.date, [e]]);
  }
  const paydays = events.filter((e) => e.kind === "income").length;
  const out = {
    bills: -w.byKind.bill,
    subscriptions: -w.byKind.subscription,
    savings: -w.byKind.goal,
    typical: -w.byKind.expense,
  };
  const firstBelow = w.belowBuffer[0] ?? null;

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Cash-flow forecast</h2>
            <Badge variant="outline">Estimate</Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Where your spendable cash is heading over the next {days} days, through {fmt.date(w.end, "monthDay")}.
          </p>
        </div>
        <Segmented<string>
          size="sm"
          value={String(days)}
          onChange={(v) => choose(Number(v) as ForecastHorizon)}
          aria-label="Forecast length"
          options={FORECAST_HORIZONS.map((h) => ({ value: String(h), label: `${h} days` }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 pb-4 lg:grid-cols-4">
        <Stat label="Cash today" value={fmt.money(w.startingBalance)} hint="Available in spendable accounts" />
        <Stat label="Money in" value={`+${fmt.money(w.totalInflow)}`} hint={paydays ? `${paydays} expected payday${paydays === 1 ? "" : "s"}` : "No pay expected"} />
        <Stat label="Money out" value={`−${fmt.money(w.totalOutflow)}`} hint="Bills, subscriptions, savings and typical spending" />
        <Stat
          label={`Balance on ${fmt.date(w.end, "monthDay")}`}
          value={fmt.money(w.endingBalance)}
          tone={w.endingBalance < 0 ? "danger" : undefined}
          hint={
            <>
              Lowest <span className="tabular font-medium text-foreground">{fmt.money(w.lowestBalance)}</span> on {fmt.date(w.lowestBalanceDate, "monthDay")}
            </>
          }
        />
      </div>

      {firstBelow ? (
        <div className="px-5 pb-3">
          <Notice tone="warning" title={`May drop below your ${fmt.money(w.minimumBuffer)} buffer on ${fmt.date(firstBelow, "monthDay")}`}>
            The estimated balance is under your buffer on {w.belowBuffer.length} of the next {days} days.
          </Notice>
        </div>
      ) : null}

      <div className="px-3 sm:px-5">
        <CashFlowLegend buffer={w.minimumBuffer} />
        <div className="mt-2">
          <CashFlowChart points={points} buffer={w.minimumBuffer} days={days} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 border-t border-border p-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="forecast-events">
          <h3 id="forecast-events" className="text-sm font-semibold text-foreground">
            Coming up
          </h3>
          {events.length ? (
            <>
              <ol className="mt-2 divide-y divide-border">
                {groups.map(([date, list]) => {
                  const rel = relativeDay(date, fmt.today);
                  return (
                    <li key={date} className="py-2.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        {fmt.date(date, "weekdayShort")}
                        {rel ? ` · ${rel}` : ""}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {list.map((e, i) => {
                          const k = KIND[e.kind as keyof typeof KIND] ?? KIND.bill;
                          const Icon = k.icon;
                          const incoming = e.amount >= 0;
                          return (
                            <li key={`${e.label}-${i}`} className="relative flex items-center gap-2.5 text-sm">
                              <span
                                className="flex size-6 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5"
                                style={{ backgroundColor: `color-mix(in oklab, ${incoming ? FORECAST_COLORS.income : FORECAST_COLORS.outflow} 14%, transparent)`, color: incoming ? FORECAST_COLORS.income : FORECAST_COLORS.outflow }}
                                aria-hidden
                              >
                                <Icon />
                              </span>
                              <span className="min-w-0 flex-1 truncate text-foreground">{e.label}</span>
                              <span className="sr-only">({k.label})</span>
                              <span className={cn("tabular shrink-0 font-medium", incoming ? "text-positive" : "text-foreground")}>
                                {incoming ? "+" : "−"}
                                {fmt.money(Math.abs(e.amount))}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ol>
              {events.length > EVENTS_SHOWN ? (
                <Button variant="ghost" size="sm" className="mt-1 -ml-2 text-primary" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                  {showAll ? "Show fewer" : `Show all ${events.length}`}
                </Button>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">No pay, bills or planned savings expected in this period.</p>
          )}
        </section>
        <section aria-labelledby="forecast-out">
          <h3 id="forecast-out" className="text-sm font-semibold text-foreground">
            Where money goes
          </h3>
          <dl className="mt-2 space-y-2 text-sm">
            {[
              { label: "Bills", value: out.bills },
              { label: "Subscriptions", value: out.subscriptions },
              { label: "Planned savings", value: out.savings },
              { label: "Typical day-to-day spending", value: out.typical, hint: `About ${fmt.money(base.dailyDiscretionary)} a day` },
            ].map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3">
                <dt className="min-w-0 text-muted-foreground">
                  {r.label}
                  {r.hint ? <span className="block text-xs">{r.hint}</span> : null}
                </dt>
                <dd className="tabular shrink-0 font-medium text-foreground">{fmt.money(r.value)}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
              <dt className="font-medium text-foreground">Total out</dt>
              <dd className="tabular font-semibold text-foreground">{fmt.money(w.totalOutflow)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Based on expected pay, unpaid bills, active subscriptions and scheduled savings, plus typical spending: your average over the last 90 days, leaving out recurring charges. Real results will differ.
          </p>
        </section>
      </div>
    </Card>
  );
}
