"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";
import { WidgetCard, WidgetEmpty } from "./widget-card";

export interface SafeToSpendData {
  safeToSpend: number;
  shortfall: number;
  perDay: number;
  nextPayday: string | null;
  horizon: string;
  daysUntilPayday: number;
  includesSavings: boolean;
  lines: { key: string; label: string; amount: number; sign: number }[];
}

export function SafeToSpendCard({ data, hasAccounts }: { data: SafeToSpendData; hasAccounts: boolean }) {
  const f = useFormat();
  const until = data.nextPayday ? `Until payday ${f.relative(data.nextPayday).toLowerCase() === "tomorrow" ? "tomorrow" : `on ${f.date(data.nextPayday, "monthDay")}`}` : "For the next 14 days (no payday detected yet)";
  return (
    <WidgetCard title="Safe to spend" description={until} href="/forecast" linkLabel="Details">
      {!hasAccounts ? (
        <WidgetEmpty
          action={
            <Button size="sm" asChild>
              <Link href="/accounts/new">Add an account</Link>
            </Button>
          }
        >
          Add an account or import transactions to see what&apos;s safe to spend.
        </WidgetEmpty>
      ) : (
        <>
          <p className={cn("tabular text-4xl font-semibold tracking-tight", data.shortfall > 0 ? "text-danger" : "text-foreground")}>{f.money(data.safeToSpend)}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {data.safeToSpend > 0 ? (
              <>
                About <span className="tabular font-medium text-foreground">{f.money(data.perDay)}</span> a day for {data.daysUntilPayday} {data.daysUntilPayday === 1 ? "day" : "days"}
              </>
            ) : (
              "Nothing left to spend safely before payday."
            )}
          </p>
          {data.shortfall > 0 ? (
            <Notice tone="warning" className="mt-3">
              Upcoming commitments are {f.money(data.shortfall)} more than your available cash.
            </Notice>
          ) : null}
          <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-[13px]">
            {data.lines.map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{l.label}</dt>
                <dd className="tabular font-medium">{l.sign < 0 ? (l.amount ? `− ${f.money(l.amount)}` : f.money(0)) : f.money(l.amount)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" aria-hidden /> Estimate based on your accounts, bills and plans{data.includesSavings ? ", including savings" : ""}.
          </p>
        </>
      )}
    </WidgetCard>
  );
}

export function CashCard({ data }: { data: { accounts: { id: string; name: string; type: string; balance: number; isHidden: boolean }[] } }) {
  const f = useFormat();
  const visible = data.accounts.filter((a) => !a.isHidden);
  const spendable = visible.filter((a) => a.type !== "SAVINGS").reduce((s, a) => s + a.balance, 0);
  const savings = visible.filter((a) => a.type === "SAVINGS").reduce((s, a) => s + a.balance, 0);
  return (
    <WidgetCard title="Cash" description="Chequing, savings and cash accounts" href="/accounts" linkLabel="Accounts">
      {visible.length === 0 ? (
        <WidgetEmpty
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/accounts/new">Add an account</Link>
            </Button>
          }
        >
          No cash accounts yet.
        </WidgetEmpty>
      ) : (
        <>
          <p className="tabular text-3xl font-semibold tracking-tight">{f.money(spendable + savings)}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-lg bg-subtle px-3 py-2">
              <p className="text-muted-foreground">Everyday</p>
              <p className="tabular font-semibold">{f.money(spendable)}</p>
            </div>
            <div className="rounded-lg bg-subtle px-3 py-2">
              <p className="text-muted-foreground">Savings</p>
              <p className="tabular font-semibold">{f.money(savings)}</p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {visible.slice(0, 4).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <Link href={`/accounts/${a.id}`} className="truncate text-muted-foreground hover:text-foreground">
                  {a.name}
                </Link>
                <span className={cn("tabular font-medium", a.balance < 0 && "text-danger")}>{f.money(a.balance)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

function Change({ value, label, positiveIsGood = true }: { value: number | null; label: string; positiveIsGood?: boolean }) {
  const f = useFormat();
  if (value === null) return <span className="text-xs text-muted-foreground">No history yet for {label}</span>;
  const good = value === 0 ? null : value > 0 === positiveIsGood;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good === null ? "text-muted-foreground" : good ? "text-positive" : "text-negative")}>
      {value > 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : value < 0 ? <ArrowDownRight className="size-3.5" aria-hidden /> : null}
      {f.money(value, { signed: true })} <span className="font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

export function NetWorthCard({ data }: { data: { netWorth: number; assets: number; liabilities: number; changeThisMonth: number | null; accountCount: number; history: { date: string; netWorth: number }[] } }) {
  const f = useFormat();
  const first = data.history[0];
  return (
    <WidgetCard title="Net worth" description="Assets minus debts" href="/net-worth" linkLabel="Details">
      {data.accountCount === 0 ? (
        <WidgetEmpty>Add accounts, loans and investments to track your net worth.</WidgetEmpty>
      ) : (
        <>
          <p className="tabular text-3xl font-semibold tracking-tight">{f.money(data.netWorth)}</p>
          <div className="mt-1">
            <Change value={data.changeThisMonth} label="this month" />
          </div>
          <div className="mt-3">
            <Sparkline
              data={data.history.map((h) => h.netWorth)}
              description={first ? `Net worth went from ${f.money(first.netWorth)} on ${f.date(first.date)} to ${f.money(data.netWorth)} today.` : "Net worth trend"}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <p className="text-muted-foreground">Assets</p>
              <p className="tabular font-semibold">{f.money(data.assets)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Debts</p>
              <p className="tabular font-semibold">{f.money(data.liabilities)}</p>
            </div>
          </div>
        </>
      )}
    </WidgetCard>
  );
}

export function IncomeSpendingCard({ data }: { data: { label: string; income: number; spending: number; previousIncome: number; previousSpending: number; savingsRateBps: number } }) {
  const f = useFormat();
  const net = data.income - data.spending;
  const spendDelta = data.spending - data.previousSpending;
  const max = Math.max(data.income, data.spending, 1);
  return (
    <WidgetCard title="Income & spending" description={data.label} href="/analytics" linkLabel="Analytics">
      <div className="space-y-3">
        {[
          { label: "Income", value: data.income, cls: "bg-positive" },
          { label: "Spending", value: data.spending, cls: "bg-chart-3" },
        ].map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="tabular text-base font-semibold">{f.money(row.value)}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={cn("h-full rounded-full", row.cls)} style={{ width: `${Math.round((row.value / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">{net >= 0 ? "Left over so far" : "Overspent so far"}</p>
          <p className={cn("tabular text-xl font-semibold", net < 0 && "text-danger")}>{f.money(net)}</p>
        </div>
        <p className="tabular mt-1 text-xs text-muted-foreground">
          {data.income > 0 ? `Savings rate ${Math.round(data.savingsRateBps / 100)}% · ` : ""}
          Spending is {spendDelta === 0 ? "the same as" : spendDelta > 0 ? `${f.money(spendDelta)} more than` : `${f.money(-spendDelta)} less than`} on the same dates last month.
        </p>
      </div>
    </WidgetCard>
  );
}
