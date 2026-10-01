"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Landmark, MoreHorizontal, RefreshCw, Trash2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { formatRelativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { disconnectConnectionAction, syncConnectionAction } from "@/app/actions/settings";

export interface ConnectionRow {
  id: string;
  provider: string;
  status: "ACTIVE" | "REQUIRES_REAUTH" | "ERROR" | "DISCONNECTED";
  institution: string;
  color: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  accountCount: number;
}

const PROVIDER_LABEL: Record<string, string> = { MOCK: "Simulated demo bank", PLAID: "Plaid", FLINKS: "Flinks", CSV: "CSV import", MANUAL: "Manual" };

const STATUS: Record<ConnectionRow["status"], { label: string; variant: "positive" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { label: "Connected", variant: "positive" },
  REQUIRES_REAUTH: { label: "Needs reconnecting", variant: "warning" },
  ERROR: { label: "Sync problem", variant: "danger" },
  DISCONNECTED: { label: "Disconnected", variant: "neutral" },
};

export function ConnectionsList({ connections }: { connections: ConnectionRow[] }) {
  const router = useRouter();
  const [syncing, setSyncing] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<{ row: ConnectionRow; mode: "disconnect" | "delete" } | null>(null);
  const [deleteData, setDeleteData] = React.useState(false);
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => setNow(new Date()), []);

  const sync = async (row: ConnectionRow) => {
    setSyncing(row.id);
    const res = await syncConnectionAction({ id: row.id });
    setSyncing(null);
    if (!res.ok) {
      toast.error(`${row.institution} couldn't be refreshed`, { description: res.error.message });
    } else if (res.data.status === "SKIPPED") {
      toast.info(res.data.message ?? "Nothing to refresh right now.");
    } else {
      toast.success(`${row.institution} is up to date`, { description: res.data.added ? `${res.data.added} new ${res.data.added === 1 ? "transaction" : "transactions"}.` : "No new transactions." });
    }
    router.refresh();
  };

  const confirm = async () => {
    if (!target) return;
    const removeData = target.mode === "delete" || deleteData;
    const res = await disconnectConnectionAction({ id: target.row.id, deleteData: removeData });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(removeData ? `${target.row.institution} and its imported data were removed` : `${target.row.institution} disconnected`, {
      description: removeData ? undefined : "Its accounts and history stay in Harbour, marked as disconnected.",
    });
    setTarget(null);
    setDeleteData(false);
    router.refresh();
  };

  if (!connections.length) {
    return (
      <EmptyState
        compact
        icon={Landmark}
        title="No bank connections"
        description="Connect a bank to import balances and transactions automatically, or keep using manual accounts and CSV imports."
        action={
          <Button asChild size="sm">
            <Link href="/accounts/new">Add an account</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {connections.map((c) => {
          const status = STATUS[c.status];
          const disconnected = c.status === "DISCONNECTED";
          const needsReconnect = c.status === "REQUIRES_REAUTH" || c.status === "ERROR";
          return (
            <li key={c.id} className="flex flex-col gap-3 px-3.5 py-3.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold", disconnected ? "bg-muted text-muted-foreground" : "text-white")}
                  style={disconnected ? undefined : { backgroundColor: c.color ?? "#0f766e" }}
                  aria-hidden
                >
                  {c.institution.trim()[0]?.toUpperCase() ?? "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
                    <span className="min-w-0 break-words">{c.institution}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {PROVIDER_LABEL[c.provider] ?? c.provider} · {c.accountCount} {c.accountCount === 1 ? "account" : "accounts"} ·{" "}
                    {c.lastSyncedAt ? `Synced ${now ? formatRelativeTime(c.lastSyncedAt, now) : "recently"}` : "Never synced"}
                  </p>
                  {c.lastSyncError && !disconnected ? (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                      <span>{c.lastSyncError}</span>
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
                {needsReconnect ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/accounts#connections">Reconnect</Link>
                  </Button>
                ) : null}
                {!disconnected ? (
                  <Button size="sm" variant="outline" onClick={() => sync(c)} loading={syncing === c.id} disabled={syncing !== null && syncing !== c.id}>
                    {syncing === c.id ? null : <RefreshCw />} Sync now
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${c.institution}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {!disconnected ? (
                      <DropdownMenuItem destructive onSelect={() => setTarget({ row: c, mode: "disconnect" })}>
                        <Unplug /> Disconnect…
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem destructive onSelect={() => setTarget({ row: c, mode: "delete" })}>
                        <Trash2 /> Delete imported data…
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            setDeleteData(false);
          }
        }}
        title={target?.mode === "delete" ? `Delete ${target.row.institution}'s data?` : `Disconnect ${target?.row.institution ?? ""}?`}
        description={
          target?.mode === "delete"
            ? `This permanently deletes ${target.row.accountCount} ${target.row.accountCount === 1 ? "account" : "accounts"} and every transaction imported from them. This can't be undone.`
            : "Harbour stops syncing and deletes its access token. Nothing changes at your bank."
        }
        confirmLabel={target?.mode === "delete" ? "Delete data" : deleteData ? "Disconnect and delete" : "Disconnect"}
        destructive
        onConfirm={confirm}
      >
        {target?.mode === "disconnect" ? (
          <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-[13px]">
            <Checkbox checked={deleteData} onCheckedChange={(v) => setDeleteData(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium text-foreground">Also delete imported data</span>
              <span className="block text-muted-foreground">
                Removes {target.row.accountCount} {target.row.accountCount === 1 ? "account" : "accounts"} and their transactions. Leave unchecked to keep your history.
              </span>
            </span>
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
