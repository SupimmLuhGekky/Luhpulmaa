"use client";

import * as React from "react";
import { ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import { relativeDay } from "@/components/bills/day-panel";
import type { SafeToSpend } from "@/lib/forecast/service";
import { cn } from "@/lib/utils";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line of the calculation; lines with details open like a disclosure. */
function Line({ op, label, amount, details, action, strong }: { op: "" | "−" | "="; label: React.ReactNode; amount: string; details?: React.ReactNode; action?: React.ReactNode; strong?: boolean }) {
  const row = (
    <>
      <span aria-hidden className="w-3 shrink-0 text-center text-muted-foreground">
        {op}
      </span>
      <span className={cn("min-w-0 flex-1", strong ? "font-semibold text-foreground" : "text-foreground")}>{label}</span>
      <span className={cn("tabular shrink-0", strong ? "font-semibold text-foreground" : "font-medium text-foreground")}>
        {op === "−" ? <span className="sr-only">minus </span> : null}
        {amount}
      </span>
    </>
  );
  if (!details) {
    return (
      <div className="flex items-center gap-2 py-2">
        {row}
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
    );
  }
  return (
    <details className="group py-2 [&_summary::-webkit-details-marker]:hidden">
      <summary className="-mx-1 flex cursor-pointer list-none items-center gap-2 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {row}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <div className="ml-5 mt-2 rounded-lg bg-subtle px-3 py-2 text-xs text-muted-foreground">{details}</div>
    </details>
  );
}

function ItemList({ items }: { items: { name: string; meta?: string; amount: string }[] }) {
  return (
    <ul className="space-y-1">
      {items.map((i, n) => (
        <li key={`${i.name}-${n}`} className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate">
            <span className="text-foreground">{i.name}</span>
            {i.meta ? <span> · {i.meta}</span> : null}
          </span>
          <span className="tabular shrink-0 text-foreground">{i.amount}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Safe to spend with every step of the calculation: available cash minus bills
 * and subscriptions before payday, budgeted essentials, planned savings and the
 * user's cash buffer.
 */
export function SafeToSpendCard({ data, onEditBuffer, className }: { data: SafeToSpend; onEditBuffer: () => void; className?: string }) {
  const fmt = useFormat();
  const line = (key: string) => data.lines.find((l) => l.key === key)?.amount ?? 0;
  const until = data.nextPayday
    ? `Until your next payday${relativeDay(data.nextPayday, fmt.today) === "Tomorrow" ? ", tomorrow" : ""} on ${fmt.date(data.nextPayday, "weekdayShort")}`
    : "For the next 14 days (no payday found yet)";
  const bills = data.details.bills;
  const reserved = data.details.reserved;
  const accounts = data.details.accounts;

  return (
    <Card className={cn("min-w-0 p-5 sm:p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Safe to spend</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{until}</p>
        </div>
        <Badge variant="outline">Estimate</Badge>
      </div>
      <p className={cn("tabular mt-3 text-4xl font-semibold tracking-tight sm:text-5xl", data.shortfall > 0 ? "text-danger" : "text-foreground")}>{fmt.money(data.safeToSpend)}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {data.safeToSpend > 0 ? (
          <>
            About <span className="tabular font-medium text-foreground">{fmt.money(data.perDay)}</span> a day for {plural(data.daysUntilPayday, "day")}.
          </>
        ) : (
          "Nothing is left to spend safely before payday."
        )}
      </p>
      {data.shortfall > 0 ? (
        <Notice tone="warning" className="mt-4" title={`${fmt.money(data.shortfall)} short`}>
          What&apos;s planned before payday is more than the cash you have available.
        </Notice>
      ) : null}

      <div className="mt-5 border-t border-border pt-2 text-sm" role="group" aria-label="How safe to spend is calculated">
        <Line
          op=""
          label="Cash available now"
          amount={fmt.money(line("availableCash"))}
          details={
            accounts.length ? (
              <>
                <p>
                  From {accounts.map((a) => a.name).join(", ")}.{" "}
                  {data.includesSavings ? "Savings accounts are included." : "Savings accounts aren't counted."}
                </p>
              </>
            ) : (
              "No chequing or cash accounts yet."
            )
          }
        />
        <Line
          op="−"
          label="Bills and subscriptions before payday"
          amount={fmt.money(line("upcomingBills"))}
          details={bills.length ? <ItemList items={bills.map((b) => ({ name: b.name, meta: fmt.date(b.date, "monthDay"), amount: fmt.money(b.amount) }))} /> : undefined}
        />
        <Line
          op="−"
          label="Set aside for budgeted essentials"
          amount={fmt.money(line("reservedBudget"))}
          details={
            reserved.length ? (
              <>
                <p className="mb-1.5">What&apos;s left in essential budget lines, for the days until payday.</p>
                <ItemList items={reserved.map((r) => ({ name: r.name, amount: fmt.money(r.amount) }))} />
              </>
            ) : undefined
          }
        />
        <Line op="−" label="Planned savings before payday" amount={fmt.money(line("plannedSavings"))} />
        <Line
          op="−"
          label="Your cash buffer"
          amount={fmt.money(line("minimumBuffer"))}
          action={
            <Button variant="ghost" size="sm" className="-my-1 h-7 px-2 text-xs text-primary" onClick={onEditBuffer}>
              Edit<span className="sr-only"> cash buffer</span>
            </Button>
          }
        />
        <div className="mt-1 border-t border-border pt-1">
          <Line op="=" label="Safe to spend" amount={fmt.money(data.safeToSpend)} strong />
        </div>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>An estimate from your balances, bills, budget and plans. Payday and variable bills are predictions.</span>
      </p>
    </Card>
  );
}
