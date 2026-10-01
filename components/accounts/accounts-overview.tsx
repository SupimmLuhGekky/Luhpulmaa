"use client";

import * as React from "react";
import Link from "next/link";
import { FileUp, Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/shared/empty-state";
import { Stat } from "@/components/shared/stat";
import { creditUtilization, groupAccounts, type AccountGroupView } from "@/lib/accounts/summary";
import { ACCOUNT_TYPE_LABELS, CASH_TYPES } from "@/lib/accounts/types";
import { cn } from "@/lib/utils";
import { AccountIcon } from "./account-icon";
import { AccountBadges, isDisconnected } from "./account-badges";
import { BankLinkDialogs, useBankLink } from "./bank-link";
import { ConnectionsPanel } from "./connections-panel";
import { DisconnectDialog, useSync, type DisconnectTarget } from "./connection-actions";
import { useAccountFormat, type AccountFormat } from "./format";
import type { AccountView, BankingInfo, ConnectionView } from "./types";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface AccountsOverviewProps {
  accounts: AccountView[];
  connections: ConnectionView[];
  /** Net worth totals from the net-worth service (accounts set to count in net worth). */
  totals: { assets: number; liabilities: number; netWorth: number };
  banking: BankingInfo;
  /** CSV import is turned on (ENABLE_CSV_IMPORT). */
  csvEnabled: boolean;
  /** Server render time, for stable relative times. */
  now: string;
  initialShowHidden: boolean;
}

export function AccountsOverview({ accounts, connections, totals, banking, csvEnabled, now, initialShowHidden }: AccountsOverviewProps) {
  const f = useAccountFormat(now);
  const [showHidden, setShowHidden] = React.useState(initialShowHidden);
  const [disconnecting, setDisconnecting] = React.useState<DisconnectTarget | null>(null);
  const link = useBankLink();
  const { syncing, syncConnection } = useSync();

  const hiddenCount = accounts.filter((a) => a.isHidden).length;
  const groups = React.useMemo(() => groupAccounts(accounts, { includeHidden: showHidden, baseCurrency: f.currency }), [accounts, showHidden, f.currency]);

  const toggleHidden = (value: boolean) => {
    setShowHidden(value);
    // Keep the choice in the URL (shareable, survives reloads) without a server round trip.
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("hidden", "1");
    else url.searchParams.delete("hidden");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  if (!accounts.length && !connections.length) {
    return (
      <Card>
        <EmptyState
          icon={Landmark}
          title="No accounts yet"
          description={
            csvEnabled
              ? "Add the accounts you want Harbour to keep track of: import a CSV from your bank (the easiest way for Neo Financial), enter an account by hand, or connect a bank."
              : "Add the accounts you want Harbour to keep track of: enter an account by hand, or connect a bank."
          }
          action={
            <>
              <Button asChild>
                <Link href="/accounts/new">
                  <Plus aria-hidden /> Add an account
                </Link>
              </Button>
              {csvEnabled ? (
                <Button variant="outline" asChild>
                  <Link href="/transactions/import">
                    <FileUp aria-hidden /> Import CSV
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />
      </Card>
    );
  }

  const counted = accounts.filter((a) => a.includeInNetWorth);
  const hiddenCounted = counted.filter((a) => a.isHidden).length;
  const excluded = accounts.length - counted.length;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:items-end sm:gap-0">
          <Stat label="Assets" value={f.money(totals.assets)} className="sm:pr-5" />
          <Stat label="Debts" value={f.money(totals.liabilities)} className="sm:border-l sm:border-border sm:px-5" />
          <Stat label="Net worth" value={f.money(totals.netWorth)} size="lg" className="order-first col-span-2 sm:order-none sm:col-span-1 sm:border-l sm:border-border sm:pl-5" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Includes {plural(counted.length, "account")} counted in net worth
          {hiddenCounted ? ` (${hiddenCounted} hidden)` : ""}
          {excluded ? ` · ${excluded} not counted` : ""}.{" "}
          <Link href="/net-worth" className="font-medium text-primary hover:underline">
            Net worth history
          </Link>
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-labelledby="your-accounts" className="min-w-0 space-y-4 lg:col-span-2">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 id="your-accounts" className="text-sm font-semibold">
              Your accounts <span className="font-normal text-muted-foreground">({showHidden ? accounts.length : accounts.length - hiddenCount})</span>
            </h2>
            {hiddenCount ? (
              <div className="flex items-center gap-2">
                <Switch id="show-hidden" checked={showHidden} onCheckedChange={toggleHidden} />
                <Label htmlFor="show-hidden" className="cursor-pointer text-[13px] font-normal text-muted-foreground">
                  Show hidden accounts ({hiddenCount})
                </Label>
              </div>
            ) : null}
          </div>
          {groups.length ? (
            groups.map((g) => <AccountGroupCard key={g.key} group={g} f={f} />)
          ) : (
            <Card>
              <EmptyState compact title="All of your accounts are hidden" description="Turn on “Show hidden accounts” to see them." />
            </Card>
          )}
        </section>

        <aside className="min-w-0 space-y-4" aria-label="Bank connections">
          <ConnectionsPanel
            connections={connections}
            banking={banking}
            f={f}
            syncing={syncing}
            reconnecting={link.busyWith}
            linkBusy={link.busy}
            onSync={(c) => void syncConnection(c)}
            onReconnect={(c) => void link.start(c)}
            onDisconnect={setDisconnecting}
          />
          {csvEnabled ? (
            <Card className="p-5">
              <div className="flex gap-3">
                <FileUp className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Banking with Neo Financial?</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">Neo doesn&apos;t connect through Plaid, but its web app exports your transactions as a CSV file you can import here.</p>
                  <Link href="/accounts/new?method=csv" className="mt-2 inline-block text-[13px] font-medium text-primary hover:underline">
                    How to export from Neo
                  </Link>
                </div>
              </div>
            </Card>
          ) : null}
        </aside>
      </div>

      <BankLinkDialogs link={link} />
      <DisconnectDialog connection={disconnecting} onOpenChange={(open) => !open && setDisconnecting(null)} />
    </div>
  );
}

function groupTotal(g: AccountGroupView<AccountView>, f: AccountFormat) {
  return g.totals.map((t) => f.amount(t.cents, t.currency)).join(" + ");
}

function AccountGroupCard({ group, f }: { group: AccountGroupView<AccountView>; f: AccountFormat }) {
  const id = `group-${group.key}`;
  return (
    <section aria-labelledby={id}>
      <Card className="overflow-hidden">
        <div className="flex items-baseline justify-between gap-3 px-4 pb-2.5 pt-4 sm:px-5">
          <h3 id={id} className="min-w-0 text-sm font-semibold">
            {group.label}
          </h3>
          <p className="tabular shrink-0 text-right text-sm font-semibold">
            {groupTotal(group, f)}
            {group.kind === "liability" ? <span className="ml-1 text-xs font-normal text-muted-foreground">owed</span> : group.kind === "mixed" ? <span className="ml-1 text-xs font-normal text-muted-foreground">net</span> : null}
          </p>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {group.accounts.map((a) => (
            <AccountRow key={a.id} account={a} f={f} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function syncLine(a: AccountView, f: AccountFormat) {
  if (a.isManual) return "Balance entered by you";
  const ago = f.ago(a.lastSyncedAt);
  if (isDisconnected(a)) return ago ? `Not syncing · last synced ${ago}` : "Not syncing";
  return ago ? `Synced ${ago}` : "Not synced yet";
}

function AccountRow({ account: a, f }: { account: AccountView; f: AccountFormat }) {
  const util = creditUtilization(a);
  const credit = a.isLiability && a.currentBalanceCents < 0;
  const sync = syncLine(a, f);
  const typeLabel = ACCOUNT_TYPE_LABELS[a.type];
  // Phones drop the type (the icon and group already say it) to keep rows short.
  const meta = [a.institution?.name, typeLabel, sync].filter(Boolean).join(" · ");
  const shortMeta = [a.institution?.name, sync].filter(Boolean).join(" · ");
  const showAvailable = CASH_TYPES.includes(a.type) && a.availableBalanceCents !== null && a.availableBalanceCents !== a.currentBalanceCents;
  const pct = util ? Math.round(util.usedBps / 100) : 0;
  return (
    <li>
      <Link
        href={`/accounts/${a.id}`}
        className={cn("flex items-center gap-3 px-4 py-3.5 transition-colors sm:px-5 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", a.isHidden && "opacity-75")}
      >
        <AccountIcon type={a.type} color={a.institution?.primaryColor} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-sm font-medium text-foreground sm:truncate">
              {a.name}
              {a.mask ? <span className="tabular ml-1.5 whitespace-nowrap font-normal text-muted-foreground">••{a.mask}</span> : null}
            </span>
            <AccountBadges account={a} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground sm:truncate" title={a.lastSyncedAt && !a.isManual ? `Last synced ${f.dateTime(a.lastSyncedAt)}` : undefined}>
            <span className="sm:hidden">{shortMeta}</span>
            <span className="hidden sm:inline">{meta}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-sm font-semibold">
            <span className={cn(!a.isLiability && a.currentBalanceCents < 0 && "text-danger")}>{f.amount(credit ? -a.currentBalanceCents : a.currentBalanceCents, a.currency)}</span>
            {a.isLiability ? <span className="ml-1 text-xs font-normal text-muted-foreground">{credit ? "credit" : "owed"}</span> : null}
          </p>
          {util ? (
            <div className="ml-auto mt-1.5 w-20 sm:w-28">
              <Progress value={util.usedBps / 100} tone={util.tone} size="sm" label={`${a.name}: ${pct}% of credit limit used`} />
              <p className="tabular mt-1 text-[11px] text-muted-foreground">
                {pct}% of {f.amount(util.limit, a.currency, { wholeDollars: true })}
              </p>
            </div>
          ) : showAvailable ? (
            <p className="tabular mt-0.5 hidden text-[11px] text-muted-foreground sm:block">{f.amount(a.availableBalanceCents!, a.currency)} available</p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
