"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useFormat } from "@/components/providers/format-provider";
import { summarizeOccurrences } from "@/lib/bills/calendar";
import { cn } from "@/lib/utils";
import { useBillActions } from "./bill-actions";
import type { BeforePayday, Occurrence } from "./types";

function Line({ label, value, tone }: { label: React.ReactNode; value: string; tone?: "danger" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={cn("min-w-0", tone === "danger" ? "font-medium text-danger" : "text-muted-foreground")}>{label}</dt>
      <dd className={cn("tabular shrink-0 font-medium", tone === "danger" ? "text-danger" : "text-foreground")}>{value}</dd>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Money needed before the next expected payday: unpaid bills from today to the day
 * before payday, subscriptions charged in that window and overdue bills. Paid
 * changes made on this page apply immediately.
 */
export function NeededBeforePayday({ data, className }: { data: BeforePayday; className?: string }) {
  const fmt = useFormat();
  const { resolve } = useBillActions();
  const bills = data.bills.filter((o) => !resolve(o).paid);
  const overdue = data.overdue.filter((o) => !resolve(o).paid);
  const billsTotal = bills.reduce((s, o) => s + o.amountCents, 0);
  const overdueTotal = overdue.reduce((s, o) => s + o.amountCents, 0);
  const total = billsTotal + data.subscriptionsTotal + overdueTotal;
  const payday = data.nextPayday;

  return (
    <Card className={cn("flex min-w-0 flex-col p-4 sm:p-5", className)}>
      <h2 className="text-[13px] font-medium text-muted-foreground">Needed before payday</h2>
      <p className="tabular mt-1 text-3xl font-semibold tracking-tight text-foreground">{fmt.money(total)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {payday ? (
          <>
            Due before your next payday, expected <span className="font-medium text-foreground">{fmt.date(payday.date, "weekdayShort")}</span>
          </>
        ) : (
          <>Due in the next 14 days (no payday found yet)</>
        )}
      </p>
      <dl className="mt-3 space-y-1 border-t border-border pt-3 text-[13px]">
        <Line label={`Bills · ${bills.length}`} value={fmt.money(billsTotal)} />
        <Line label={`Subscriptions · ${data.subscriptions.length}`} value={fmt.money(data.subscriptionsTotal)} />
        {overdue.length ? <Line tone="danger" label={`Overdue bills · ${overdue.length}`} value={fmt.money(overdueTotal)} /> : null}
      </dl>
      <p className="mt-auto flex items-start gap-1.5 pt-3 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          {payday ? "Payday is estimated from your income." : "Add your pay schedule to plan up to payday."}{" "}
          <Link href="/income" className="font-medium text-primary underline-offset-4 hover:underline">
            {payday ? "Income" : "Add income"}
          </Link>
        </span>
      </p>
    </Card>
  );
}

/** Totals for the period on screen (a month, or a week in the week view). */
export function PeriodTotals({ title, occurrences, className }: { title: string; occurrences: Occurrence[]; className?: string }) {
  const fmt = useFormat();
  const { resolve } = useBillActions();
  const t = summarizeOccurrences(occurrences.map(resolve), fmt.today);
  const pct = t.total ? (t.paidTotal / t.total) * 100 : 0;
  return (
    <Card className={cn("flex min-w-0 flex-col p-4 sm:p-5", className)}>
      <h2 className="text-[13px] font-medium text-muted-foreground">{title}</h2>
      <p className="tabular mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{fmt.money(t.total)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t.count ? `${t.paidCount} of ${plural(t.count, "bill")} marked paid` : "No bills due"}
      </p>
      {t.count ? (
        <div className="mt-auto pt-4">
          <Progress value={pct} label={`${title}: share marked paid`} tone="positive" size="sm" />
          <div className="tabular mt-2 hidden flex-wrap justify-between gap-x-3 text-xs text-muted-foreground sm:flex">
            <span>
              <span className="font-medium text-foreground">{fmt.money(t.paidTotal)}</span> paid
            </span>
            <span>
              <span className="font-medium text-foreground">{fmt.money(t.unpaidTotal)}</span> left
            </span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** Monthly equivalent of every active repeating bill. */
export function MonthlyTotal({ monthly, yearly, count, className }: { monthly: number; yearly: number; count: number; className?: string }) {
  const fmt = useFormat();
  return (
    <Card className={cn("flex min-w-0 flex-col p-4 sm:p-5", className)}>
      <h2 className="text-[13px] font-medium text-muted-foreground">Bills per month</h2>
      <p className="tabular mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{fmt.money(monthly)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {plural(count, "repeating bill")} · <span className="tabular whitespace-nowrap">{fmt.money(yearly)} a year</span>
      </p>
      <p className="mt-auto hidden pt-4 text-xs text-muted-foreground sm:block">Weekly, quarterly and yearly bills are converted to a monthly amount.</p>
    </Card>
  );
}
