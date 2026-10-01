"use client";

import Link from "next/link";
import { Info, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { useFormat } from "@/components/providers/format-provider";
import { useParamNavigation } from "@/components/analytics/use-param-navigation";
import { NET_WORTH_RANGES, NET_WORTH_RANGE_LABELS, type NetWorthRange } from "@/lib/networth/contributions";
import type { NetWorthOverview } from "@/lib/networth/service";
import { cn } from "@/lib/utils";
import { BreakdownCard, ChangeText } from "./breakdown-card";
import { NET_WORTH_COLORS, NetWorthChart } from "./net-worth-chart";

const RANGE_NAMES: Record<NetWorthRange, string> = { "1m": "1 month", "3m": "3 months", "6m": "6 months", ytd: "Year to date", "1y": "1 year", all: "All history" };

/** Assets and debts on one scale, so their relative size is visible at a glance. */
function AssetsVsDebts({ assets, debts }: { assets: number; debts: number }) {
  const fmt = useFormat();
  const max = Math.max(assets, debts, 1);
  const rows = [
    { label: "Assets", value: assets, color: NET_WORTH_COLORS.assets },
    { label: "Debts", value: debts, color: NET_WORTH_COLORS.debts },
  ];
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
          <span className="text-muted-foreground">{r.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${Math.max(r.value > 0 ? 1 : 0, (r.value / max) * 100)}%`, backgroundColor: r.color }} />
          </div>
          <span className="tabular text-right font-medium text-foreground">{fmt.money(r.value)}</span>
        </div>
      ))}
      {assets > 0 ? (
        <p className="text-xs text-muted-foreground">
          Debts equal <span className="tabular font-medium text-foreground">{Math.round((debts / assets) * 100)}%</span> of assets.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Net worth: today's figure and its change over the chosen range, the daily history,
 * assets against debts, and each group's and account's part in it. Accounts left out
 * of net worth are listed with a link to change that.
 */
export function NetWorthView({ data }: { data: NetWorthOverview }) {
  const fmt = useFormat();
  const { navigate, pending } = useParamNavigation();
  const { summary, history, change, accounts } = data;
  const sinceLabel = change ? `since ${fmt.date(change.from, "monthDay")}` : null;
  const pct = change && history[0].netWorth > 0 ? Math.round((change.amount / history[0].netWorth) * 100) : null;
  const assets = accounts.groups.filter((g) => g.side === "asset");
  const debts = accounts.groups.filter((g) => g.side === "liability");
  const header = (
    <PageHeader
      title="Net worth"
      description="What you own minus what you owe, across the accounts you include in net worth."
      actions={
        <Button asChild variant="outline">
          <Link href="/accounts">Manage accounts</Link>
        </Button>
      }
    />
  );

  if (summary.accountCount === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Landmark}
            title={accounts.excluded.length ? "No accounts count toward net worth" : "Add your accounts to see your net worth"}
            description={
              accounts.excluded.length
                ? "All your accounts are set to stay out of net worth. Include one from its account page."
                : "Add bank accounts, credit cards, loans and investments, and Harbour adds up what you own and what you owe."
            }
            action={
              <Button asChild>
                <Link href={accounts.excluded.length ? "/accounts" : "/accounts/new"}>{accounts.excluded.length ? "Go to accounts" : "Add an account"}</Link>
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className={cn("space-y-4 transition-opacity duration-200", pending && "opacity-60")} aria-busy={pending || undefined}>
        <Card className="min-w-0 p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">Net worth today</h2>
                  <p className={cn("tabular mt-1 text-4xl font-semibold tracking-tight sm:text-5xl", summary.netWorth < 0 ? "text-danger" : "text-foreground")}>{fmt.money(summary.netWorth)}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    {change ? (
                      <span>
                        <ChangeText value={change.amount} suffix={sinceLabel ?? undefined} />
                        {pct !== null && pct !== 0 ? <span className="tabular text-muted-foreground"> ({pct > 0 ? "+" : "−"}{Math.abs(pct)}%)</span> : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">History builds up as Harbour records your balances each day.</span>
                    )}
                    {summary.changeThisMonth !== null ? (
                      <span className="text-muted-foreground">
                        This month <span className="tabular font-medium text-foreground">{fmt.money(summary.changeThisMonth, { signed: true })}</span>
                      </span>
                    ) : null}
                  </p>
                </div>
                <Segmented<NetWorthRange>
                  size="sm"
                  value={data.range}
                  onChange={(r) => navigate({ range: r === "6m" ? null : r }, { replace: true })}
                  aria-label="History range"
                  options={NET_WORTH_RANGES.map((r) => ({
                    value: r,
                    label: (
                      <>
                        <span aria-hidden title={RANGE_NAMES[r]}>
                          {NET_WORTH_RANGE_LABELS[r]}
                        </span>
                        <span className="sr-only">{RANGE_NAMES[r]}</span>
                      </>
                    ),
                  }))}
                />
              </div>
              <div className="mt-4 -mx-1">
                {history.length > 1 ? (
                  <NetWorthChart points={history} today={data.today} />
                ) : (
                  <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-[13px] text-muted-foreground">
                    Harbour records your account balances once a day. The chart fills in from tomorrow.
                  </div>
                )}
              </div>
            </div>
            <div className="min-w-0 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <h2 className="text-sm font-semibold text-foreground">Assets and debts</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Net worth is assets minus debts.</p>
              <div className="mt-4">
                <AssetsVsDebts assets={summary.assets} debts={summary.liabilities} />
              </div>
              {change ? (
                <dl className="mt-5 space-y-2 border-t border-border pt-4 text-[13px]">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Assets {sinceLabel}</dt>
                    <dd>
                      <ChangeText value={change.assets} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Debts {sinceLabel}</dt>
                    <dd>
                      <ChangeText value={change.liabilities} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                    <dt className="font-medium text-foreground">Net worth {sinceLabel}</dt>
                    <dd className="tabular font-semibold text-foreground">{fmt.money(change.amount, { signed: true })}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <BreakdownCard side="asset" total={summary.assets} change={change?.assets ?? null} groups={assets} sinceLabel={sinceLabel} />
          <BreakdownCard side="liability" total={summary.liabilities} change={change?.liabilities ?? null} groups={debts} sinceLabel={sinceLabel} />
        </div>

        {accounts.excluded.length ? (
          <Card className="min-w-0 p-5">
            <h2 className="text-sm font-semibold text-foreground">Not counted in net worth</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">You chose to leave these accounts out. Change it from each account&apos;s page.</p>
            <ul className="mt-3 divide-y divide-border">
              {accounts.excluded.map((a) => (
                <li key={a.id}>
                  <Link href={`/accounts/${a.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="min-w-0 truncate text-sm text-foreground">{a.name}</span>
                    <span className="tabular shrink-0 text-sm text-muted-foreground">
                      {a.side === "liability" ? "Owed " : ""}
                      {fmt.money(a.balance)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Balances come from your connected and manual accounts, converted to {fmt.currency} where needed. Manual accounts are only as current as their last update.
          </span>
        </p>
      </div>
    </>
  );
}
