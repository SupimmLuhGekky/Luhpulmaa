"use client";

import Link from "next/link";
import { FlaskConical, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { connectionState } from "@/lib/accounts/summary";
import { cn } from "@/lib/utils";
import { InstitutionIcon } from "./account-icon";
import { ConnectionStatusBadge } from "./account-badges";
import type { AccountFormat } from "./format";
import type { BankingInfo, ConnectionView } from "./types";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface ConnectionsPanelProps {
  connections: ConnectionView[];
  banking: BankingInfo;
  f: AccountFormat;
  syncing: string | null;
  /** Connection id whose reconnect is starting (button spinner), if any. */
  reconnecting: string | null | undefined;
  linkBusy: boolean;
  onSync: (c: ConnectionView) => void;
  onReconnect: (c: ConnectionView) => void;
  onDisconnect: (c: ConnectionView) => void;
}

/** Provider connections with their health and Sync now / Reconnect / Disconnect. */
export function ConnectionsPanel({ connections, banking, f, syncing, reconnecting, linkBusy, onSync, onReconnect, onDisconnect }: ConnectionsPanelProps) {
  const canConnect = banking.enabled && banking.configured;
  return (
    <Card>
      <CardHeading
        title="Bank connections"
        description={banking.simulated ? "Simulated banks for trying Harbour" : canConnect ? `Accounts that update through ${banking.displayName}` : "Accounts that update automatically"}
        action={
          canConnect ? (
            <Button size="sm" variant="ghost" asChild>
              <Link href="/accounts/new?method=connect">
                <Plus aria-hidden /> Connect
              </Link>
            </Button>
          ) : undefined
        }
      />
      {connections.length === 0 ? (
        <div className="px-5 pb-5">
          <div className="rounded-lg border border-dashed border-border bg-subtle px-4 py-4 text-[13px] text-muted-foreground">
            {canConnect ? (
              <>No banks connected yet. Connected accounts update their balances and transactions automatically.</>
            ) : (
              <>Bank connections aren&apos;t set up on this server. Import CSV files from your bank or add accounts by hand instead.</>
            )}
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {connections.map((c) => {
            const state = connectionState(c.status);
            const synced = c.lastSyncedAt ? `${c.status === "DISCONNECTED" ? "Last synced" : "Synced"} ${f.ago(c.lastSyncedAt)}` : "Never synced";
            return (
              <li key={c.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <InstitutionIcon color={c.color} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 truncate text-sm font-medium">{c.institution}</p>
                      <ConnectionStatusBadge status={c.status} />
                      {c.provider === "MOCK" ? (
                        <Badge variant="info" title="Demo data from a simulated bank.">
                          <FlaskConical aria-hidden /> Simulated
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground" title={c.lastSyncedAt ? f.dateTime(c.lastSyncedAt) : undefined}>
                      {plural(c.accountCount, "account")} · {synced}
                    </p>
                    {c.lastSyncError ? (
                      <p className={cn("mt-1.5 text-xs", c.status === "ACTIVE" ? "text-warning" : "text-danger")}>
                        <span className="font-medium">Last sync failed:</span> {c.lastSyncError}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {state.needsReconnect ? (
                        <Button size="sm" onClick={() => onReconnect(c)} loading={reconnecting === c.id} disabled={linkBusy && reconnecting !== c.id}>
                          {reconnecting === c.id ? null : <RefreshCw aria-hidden />} Reconnect
                        </Button>
                      ) : null}
                      {state.canSync ? (
                        <Button size="sm" variant="outline" onClick={() => onSync(c)} loading={syncing === c.id} disabled={syncing !== null && syncing !== c.id}>
                          {syncing === c.id ? null : <RefreshCw aria-hidden />} {syncing === c.id ? "Syncing…" : "Sync now"}
                          <span className="sr-only"> {c.institution}</span>
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => onDisconnect(c)}>
                        {c.status === "DISCONNECTED" ? "Delete history…" : "Disconnect…"}
                        <span className="sr-only"> {c.institution}</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
