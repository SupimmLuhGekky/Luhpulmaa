"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, FileUp, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { AreaChart } from "@/components/charts/area-chart";
import { CategoryIcon } from "@/components/shared/category-icon";
import { Notice } from "@/components/shared/notice";
import { PageHeader } from "@/components/shared/page-header";
import { useShell } from "@/components/layout/shell-provider";
import { creditUtilization, dailyBalanceSeries, downsample, HISTORY_RANGES, historyRangeStart, type BalancePoint, type HistoryRange } from "@/lib/accounts/summary";
import { ACCOUNT_TYPE_LABELS, CASH_TYPES, hasCreditLimit } from "@/lib/accounts/types";
import { connectionState } from "@/lib/accounts/summary";
import { cn } from "@/lib/utils";
import { AccountIcon } from "./account-icon";
import { AccountBadges, isDisconnected, needsAttention } from "./account-badges";
import { AccountSettings } from "./account-settings";
import { UpdateBalanceDialog } from "./balance-dialog";
import { BankLinkDialogs, useBankLink } from "./bank-link";
import { DisconnectDialog, useSync, type DisconnectTarget } from "./connection-actions";
import { useAccountFormat, type AccountFormat } from "./format";
import type { AccountView, ConnectionView } from "./types";

export interface RecentTransaction {
  id: string;
  date: string;
  merchantName: string;
  amountCents: number;
  currency: string;
  isPending: boolean;
  isTransfer: boolean;
  category: { name: string; icon: string; color: string } | null;
}

export interface AccountDetailProps {
  account: AccountView;
  history: BalancePoint[];
  last90: { income: number; spending: number; count: number; from: string };
  recent: RecentTransaction[];
  transactionCount: number;
  connection: ConnectionView | null;
  /** CSV import is turned on (ENABLE_CSV_IMPORT). */
  csvEnabled: boolean;
  now: string;
}

export function AccountDetail({ account, history, last90, recent, transactionCount, connection, csvEnabled, now }: AccountDetailProps) {
  const f = useAccountFormat(now);
  const { openQuickAdd } = useShell();
  const link = useBankLink();
  const { syncing, syncAccount } = useSync();
  const [balanceOpen, setBalanceOpen] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState<DisconnectTarget | null>(null);

  const state = connection ? connectionState(connection.status) : null;
  const institution = connection?.institution ?? account.institution?.name ?? "your bank";
  // Quick add only offers visible, active accounts; don't open it for this one otherwise.
  const canAddTransaction = account.status === "ACTIVE" && !account.isHidden;
  const reconnect = () => connection && void link.start(connection);
  const sync = () => void syncAccount(account.id, institution);

  return (
    <>
      <Link href="/accounts" className="mb-3 inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Accounts
      </Link>
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-3">
            <AccountIcon type={account.type} color={account.institution?.primaryColor} size="lg" />
            <span className="min-w-0 break-words">
              {account.name}
              {account.mask ? <span className="tabular ml-2 whitespace-nowrap text-base font-normal text-muted-foreground sm:text-lg">••{account.mask}</span> : null}
            </span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span>{[account.institution?.name, ACCOUNT_TYPE_LABELS[account.type]].filter(Boolean).join(" · ")}</span>
            <AccountBadges account={account} />
          </span>
        }
        actions={
          <>
            {canAddTransaction ? (
              <Button variant="outline" onClick={() => openQuickAdd({ accountId: account.id })}>
                <Plus aria-hidden /> Add transaction
              </Button>
            ) : null}
            {account.isManual ? (
              <Button onClick={() => setBalanceOpen(true)}>Update balance</Button>
            ) : state?.canSync ? (
              <Button onClick={sync} loading={syncing === account.id}>
                {syncing === account.id ? null : <RefreshCw aria-hidden />} {syncing === account.id ? "Syncing…" : "Sync now"}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-4">
        {connection && needsAttention(account) ? (
          <Notice
            tone="warning"
            title={connection.status === "REQUIRES_REAUTH" ? `${institution} needs you to sign in again` : `${institution} couldn't be synced`}
            action={
              <Button size="sm" onClick={reconnect} loading={link.busyWith === connection.id}>
                Reconnect
              </Button>
            }
          >
            {connection.lastSyncError ?? "Reconnect to keep this account up to date."}
          </Notice>
        ) : null}
        {connection && isDisconnected(account) ? (
          <Notice
            tone="neutral"
            title="This account is disconnected"
            action={
              <Button size="sm" variant="outline" onClick={reconnect} loading={link.busyWith === connection.id}>
                Reconnect
              </Button>
            }
          >
            Harbour no longer syncs it. Its transactions are kept, and the balance is the last one received{account.lastSyncedAt ? ` ${f.ago(account.lastSyncedAt)}` : ""}.
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <BalanceCard account={account} history={history} f={f} />
            <RecentTransactionsCard account={account} rows={recent} total={transactionCount} f={f} canAdd={canAddTransaction} canImport={csvEnabled && account.isManual} onAdd={() => openQuickAdd({ accountId: account.id })} />
          </div>
          <div className="min-w-0 space-y-4">
            <ActivityCard last90={last90} currency={account.currency} f={f} />
            <AccountSettings
              account={account}
              connection={connection}
              transactionCount={transactionCount}
              f={f}
              syncing={syncing === account.id}
              reconnecting={Boolean(connection) && link.busyWith === connection?.id}
              linkBusy={link.busy}
              onSync={sync}
              onReconnect={reconnect}
              onDisconnect={() => connection && setDisconnecting(connection)}
              onUpdateBalance={() => setBalanceOpen(true)}
            />
          </div>
        </div>
      </div>

      {account.isManual ? <UpdateBalanceDialog account={account} open={balanceOpen} onOpenChange={setBalanceOpen} /> : null}
      <BankLinkDialogs link={link} />
      <DisconnectDialog connection={disconnecting} onOpenChange={(open) => !open && setDisconnecting(null)} />
    </>
  );
}

function asOfLine(account: AccountView, f: AccountFormat) {
  if (account.isManual) return "Entered by you";
  const ago = f.ago(account.lastSyncedAt);
  if (isDisconnected(account)) return ago ? `Last synced ${ago} · no longer updating` : "No longer updating";
  return ago ? `Synced ${ago}` : "Waiting for the first sync";
}

function BalanceCard({ account, history, f }: { account: AccountView; history: BalancePoint[]; f: AccountFormat }) {
  const [range, setRange] = React.useState<HistoryRange>("3m");
  const owed = account.isLiability;
  const util = creditUtilization(account);
  const credit = owed && account.currentBalanceCents < 0;

  const from = historyRangeStart(f.today, range);
  const series = React.useMemo(() => downsample(dailyBalanceSeries(history, from, f.today), 120), [history, from, f.today]);
  const first = series[0];
  const change = series.length >= 2 ? series[series.length - 1].balance - first.balance : null;
  const rangeInfo = HISTORY_RANGES.find((r) => r.key === range)!;
  const changeLabel = first && first.date > from ? `since ${f.date(first.date, "monthDay")}` : `in the last ${rangeInfo.description}`;
  // A debt going down is good news, as is a balance going up.
  const good = change !== null && change > 0 !== owed;

  const facts: { label: string; value: string }[] = [];
  if (CASH_TYPES.includes(account.type) && account.availableBalanceCents !== null) facts.push({ label: "Available", value: f.amount(account.availableBalanceCents, account.currency) });
  if (hasCreditLimit(account.type)) {
    if (util) facts.push({ label: "Available credit", value: f.amount(util.available, account.currency) });
    else if (account.availableBalanceCents !== null && !account.isManual) facts.push({ label: "Available credit", value: f.amount(account.availableBalanceCents, account.currency) });
    facts.push({ label: "Credit limit", value: account.creditLimitCents ? f.amount(account.creditLimitCents, account.currency) : "Not set" });
  }
  const pct = util ? Math.round(util.usedBps / 100) : 0;

  return (
    <Card>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">{owed ? (credit ? "Credit balance" : "Amount owed") : "Current balance"}</p>
          <p className={cn("tabular mt-1 text-3xl font-semibold tracking-tight", !owed && account.currentBalanceCents < 0 && "text-danger")}>{f.amount(credit ? -account.currentBalanceCents : account.currentBalanceCents, account.currency)}</p>
          <p className="mt-1 text-xs text-muted-foreground" title={account.lastSyncedAt && !account.isManual ? f.dateTime(account.lastSyncedAt) : undefined}>
            {asOfLine(account, f)}
            {account.isSimulated ? " · simulated demo data, not a real account" : ""}
          </p>
        </div>
        {facts.length ? (
          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:text-right">
            {facts.map((x) => (
              <div key={x.label} className="min-w-0">
                <dt className="text-muted-foreground">{x.label}</dt>
                <dd className="tabular font-semibold">{x.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {util ? (
        <div className="-mt-1 px-5 pb-5">
          <Progress value={util.usedBps / 100} tone={util.tone} label={`${pct}% of the credit limit used`} />
          <p className="tabular mt-1.5 text-xs text-muted-foreground">
            {pct}% of your {f.amount(util.limit, account.currency, { wholeDollars: true })} limit used{util.usedBps > 10000 ? " · over the limit" : ""}
          </p>
        </div>
      ) : null}
      <div className="border-t border-border px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{owed ? "Amount owed over time" : "Balance history"}</h2>
            {change === 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">No change {changeLabel}</p>
            ) : change !== null ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs">
                <span className={cn("inline-flex items-center gap-0.5 font-medium", good ? "text-positive" : "text-negative")}>
                  {change > 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                  {f.amount(change, account.currency, { signed: true })}
                </span>
                <span className="text-muted-foreground">{changeLabel}</span>
              </p>
            ) : null}
          </div>
          <Segmented size="sm" aria-label="History range" value={range} onChange={setRange} options={HISTORY_RANGES.map((r) => ({ value: r.key, label: r.label }))} />
        </div>
        <div className="mt-3">
          {series.length >= 2 ? (
            <AreaChart
              label={`${owed ? "Amount owed" : "Balance"} of ${account.name} ${changeLabel}`}
              data={series.map((p) => ({ date: p.date, balance: p.balance }))}
              xKey="date"
              series={[{ key: "balance", label: owed ? "Amount owed" : "Balance", color: owed ? "var(--chart-3)" : "var(--chart-1)" }]}
              height={220}
            />
          ) : (
            <div className="flex h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-subtle px-4 text-center text-[13px] text-muted-foreground">
              <p>Not enough history yet.</p>
              <p className="mt-1 text-xs">{account.isManual ? "Each balance update adds a point to this chart." : "The chart fills in as Harbour syncs this account."}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ActivityCard({ last90, currency, f }: { last90: AccountDetailProps["last90"]; currency: string; f: AccountFormat }) {
  const rows = [
    { label: "Income", value: f.amount(last90.income, currency), className: last90.income > 0 ? "text-positive" : undefined },
    { label: "Spending", value: f.amount(last90.spending, currency) },
    { label: "Transactions", value: last90.count.toLocaleString(f.locale) },
  ];
  return (
    <Card>
      <CardHeading title="Last 90 days" description={`Since ${f.date(last90.from, "medium")}`} />
      {last90.count === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">No transactions in this account in the last 90 days.</p>
      ) : (
        <>
          <dl className="space-y-2 px-5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-muted-foreground">{r.label}</dt>
                <dd className={cn("tabular text-sm font-semibold", r.className)}>{r.value}</dd>
              </div>
            ))}
          </dl>
          <p className="px-5 pb-5 pt-3 text-xs text-muted-foreground">Transfers between your own accounts aren&apos;t counted as income or spending.</p>
        </>
      )}
    </Card>
  );
}

function RecentTransactionsCard({ account, rows, total, f, canAdd, canImport, onAdd }: { account: AccountView; rows: RecentTransaction[]; total: number; f: AccountFormat; canAdd: boolean; canImport: boolean; onAdd: () => void }) {
  return (
    <Card>
      <CardHeading
        title="Recent transactions"
        description={total ? `${total.toLocaleString(f.locale)} in this account` : undefined}
        action={
          total ? (
            <Link href={`/transactions?account=${account.id}`} className="inline-flex items-center gap-0.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              See all
              <ChevronRight className="size-3.5" aria-hidden />
              <span className="sr-only"> transactions in {account.name}</span>
            </Link>
          ) : undefined
        }
      />
      {rows.length ? (
        <ul className="divide-y divide-border px-3 pb-3">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/transactions?txn=${t.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent">
                <CategoryIcon icon={t.category?.icon} color={t.category?.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{t.merchantName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {f.relative(t.date)} · {t.category?.name ?? "Uncategorized"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn("tabular text-[13px] font-medium", t.amountCents > 0 && !t.isTransfer && "text-positive")}>{f.amount(t.amountCents, t.currency, { signed: t.amountCents > 0 })}</p>
                  {t.isPending ? <p className="text-[11px] text-muted-foreground">Pending</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-5 pb-5">
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-subtle px-4 py-5 text-[13px] text-muted-foreground">
            <p>{account.isManual ? `No transactions in this account yet. Add them by hand${canImport ? " or import a CSV from your bank" : ""}.` : "No transactions have been imported for this account yet."}</p>
            <div className="flex flex-wrap gap-2">
              {canAdd ? (
                <Button size="sm" variant="outline" onClick={onAdd}>
                  <Plus aria-hidden /> Add transaction
                </Button>
              ) : null}
              {canImport ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href="/transactions/import">
                    <FileUp aria-hidden /> Import CSV
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
