"use client";

import { Repeat } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { useFormat } from "@/components/providers/format-provider";
import { useParamNavigation } from "@/components/analytics/use-param-navigation";
import { relativeDay } from "@/components/bills/day-panel";
import type { UpcomingCharge } from "@/lib/subscriptions/upcoming";
import { cn } from "@/lib/utils";
import { RecurringCandidates } from "./recurring-candidates";
import { SubscriptionActionsProvider } from "./subscription-actions";
import { AddSubscriptionButton, SubscriptionList } from "./subscription-list";
import type { RecurringCandidate, SubscriptionFormOptions, SubscriptionRow, SubscriptionTotals } from "./types";

export interface SubscriptionsViewProps {
  rows: SubscriptionRow[];
  totals: SubscriptionTotals;
  upcoming: UpcomingCharge[];
  upcomingDays: number;
  candidates: RecurringCandidate[];
  billSeries: string[];
  options: SubscriptionFormOptions;
  openNew: boolean;
}

function Kpi({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("min-w-0 p-4 sm:p-5", className)}>
      <h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2>
      <div className="tabular mt-1 truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{value}</div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export function SubscriptionsView({ rows, totals, upcoming, upcomingDays, candidates, billSeries, options, openNew }: SubscriptionsViewProps) {
  const fmt = useFormat();
  const { navigate } = useParamNavigation();
  const bills = new Set(billSeries);
  const active = rows.filter((r) => r.status === "ACTIVE");
  const inactive = rows.filter((r) => r.status !== "ACTIVE");
  const upcomingTotal = upcoming.reduce((s, c) => s + c.amountCents, 0);
  const next = upcoming[0] ?? null;
  const nextRel = next ? relativeDay(next.date, fmt.today) : null;

  return (
    <SubscriptionActionsProvider options={options} initialCreate={openNew} onCreateClosed={() => openNew && navigate({ new: null }, { replace: true })}>
      <PageHeader
        title="Subscriptions"
        description="Streaming, phone plans, memberships and other repeating charges. Changes here only update Harbour, never the provider."
        actions={rows.length || candidates.length ? <AddSubscriptionButton /> : undefined}
      />
      {rows.length === 0 ? (
        <div className="space-y-4">
          <Card>
            <EmptyState
              icon={Repeat}
              title="No subscriptions yet"
              description={
                candidates.length
                  ? "Harbour found repeating charges in your transactions. Mark the subscriptions below, or add one yourself."
                  : "Harbour spots repeating charges like streaming and phone plans once a few months of transactions are in. You can also add one yourself."
              }
              action={<AddSubscriptionButton variant={candidates.length ? "outline" : "primary"} />}
            />
          </Card>
          <RecurringCandidates candidates={candidates} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Kpi label="Per month" value={fmt.money(totals.monthly)} hint={`${totals.count} active subscription${totals.count === 1 ? "" : "s"}`} />
            <Kpi label="Per year" value={fmt.money(totals.yearly)} hint="At current prices" />
            <Kpi label={`Next ${upcomingDays} days`} value={fmt.money(upcomingTotal)} hint={`${upcoming.length} expected charge${upcoming.length === 1 ? "" : "s"} (estimate)`} />
            <Kpi
              label="Next charge"
              value={next ? <span title={next.name}>{next.name}</span> : "None scheduled"}
              hint={next ? `${fmt.money(next.amountCents)} · ${nextRel ?? fmt.date(next.date, "monthDay")}` : "Add a next charge date to see it here"}
            />
          </div>
          {active.length ? (
            <SubscriptionList title="Active" description="Sorted by next charge." rows={active} billSeries={bills} />
          ) : (
            <Card>
              <EmptyState compact title="No active subscriptions" description="Resume a paused one or add a new subscription." />
            </Card>
          )}
          {inactive.length ? <SubscriptionList title="Paused and cancelled" description="Not counted in your totals or reminders." rows={inactive} billSeries={bills} muted /> : null}
          <RecurringCandidates candidates={candidates} />
          {bills.size && active.some((r) => r.recurringId && bills.has(r.recurringId)) ? (
            <p className="text-xs text-muted-foreground">&ldquo;Also a bill&rdquo; charges are counted once, as bills, in your cash-flow estimate and safe-to-spend.</p>
          ) : null}
        </div>
      )}
    </SubscriptionActionsProvider>
  );
}
