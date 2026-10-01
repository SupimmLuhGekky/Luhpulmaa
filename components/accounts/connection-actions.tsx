"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/shared/field";
import { cn } from "@/lib/utils";
import { disconnectConnectionAction, syncAccountAction, syncConnectionAction } from "@/app/actions/accounts";
import type { ConnectionView } from "./types";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

type SyncResult = Awaited<ReturnType<typeof syncConnectionAction>>;

/** Runs "Sync now" for a connection or an account and reports the outcome as a toast. */
export function useSync() {
  const router = useRouter();
  const [syncing, setSyncing] = React.useState<string | null>(null);

  const report = React.useCallback(
    (res: SyncResult, institution: string) => {
      if (!res.ok) {
        toast.error(`Couldn't sync ${institution}`, { description: res.error.message });
        return;
      }
      const o = res.data;
      if (o.status === "FAILED") toast.error(`Couldn't sync ${institution}`, { description: o.message });
      else if (o.status === "SKIPPED") toast.info(o.message ?? "Nothing to sync right now.");
      else toast.success(`${institution} is up to date`, { description: o.added ? `${plural(o.added, "new transaction")} imported.` : "No new transactions." });
      router.refresh();
    },
    [router],
  );

  const syncConnection = React.useCallback(
    async (connection: Pick<ConnectionView, "id" | "institution">) => {
      setSyncing(connection.id);
      try {
        report(await syncConnectionAction({ connectionId: connection.id }), connection.institution);
      } finally {
        setSyncing(null);
      }
    },
    [report],
  );

  const syncAccount = React.useCallback(
    async (accountId: string, institution: string) => {
      setSyncing(accountId);
      try {
        report(await syncAccountAction({ accountId }), institution);
      } finally {
        setSyncing(null);
      }
    },
    [report],
  );

  return { syncing, syncConnection, syncAccount };
}

export type DisconnectTarget = Pick<ConnectionView, "id" | "institution" | "accountCount" | "status">;

/**
 * Disconnect a bank: revokes Harbour's access token at the provider. The person
 * chooses whether the imported accounts and transactions stay (marked disconnected)
 * or are deleted. For an already-disconnected connection this only deletes history.
 */
export function DisconnectDialog({ connection, onOpenChange, onDone }: { connection: DisconnectTarget | null; onOpenChange: (open: boolean) => void; onDone?: (deleted: boolean) => void }) {
  const router = useRouter();
  const [choice, setChoice] = React.useState<"keep" | "delete">("keep");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const alreadyDisconnected = connection?.status === "DISCONNECTED";
  const deleting = alreadyDisconnected || choice === "delete";
  const accounts = plural(connection?.accountCount ?? 0, "account");

  React.useEffect(() => {
    if (connection) {
      setChoice("keep");
      setError(null);
    }
  }, [connection]);

  const confirm = async () => {
    if (!connection) return;
    setPending(true);
    setError(null);
    const res = await disconnectConnectionAction({ connectionId: connection.id, deleteData: deleting });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(deleting ? `${connection.institution} and its history were deleted` : `${connection.institution} is disconnected`, {
      description: deleting ? undefined : "Its accounts and transactions are kept. You can reconnect any time.",
    });
    onOpenChange(false);
    onDone?.(deleting);
    router.refresh();
  };

  const option = (value: "keep" | "delete", title: string, body: string) => (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        choice === value && (value === "delete" ? "border-danger/50 bg-danger-soft" : "border-primary/50 bg-primary-soft"),
      )}
    >
      <input type="radio" name="disconnect-history" value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">{body}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={Boolean(connection)} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="md" role="alertdialog">
        <DialogHeader>
          <DialogTitle>{alreadyDisconnected ? `Delete ${connection?.institution} history?` : `Disconnect ${connection?.institution}?`}</DialogTitle>
          <DialogDescription>
            {alreadyDisconnected
              ? `This permanently deletes the ${accounts} imported from this bank and all of their transactions. This can't be undone.`
              : `Harbour will stop syncing ${connection?.accountCount === 1 ? "its account" : `its ${accounts}`} and delete its access to this bank. Nothing changes at your bank.`}
          </DialogDescription>
        </DialogHeader>
        {!alreadyDisconnected ? (
          <DialogBody>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-[13px] font-medium text-foreground">What should happen to the imported history?</legend>
              {option("keep", "Keep accounts and transactions", "They stay in your budgets, reports and net worth, marked as disconnected. You can reconnect later.")}
              {option("delete", "Delete accounts and transactions", `Permanently removes the ${accounts} and every transaction imported from them. This can't be undone.`)}
            </fieldset>
            <div className="mt-3">
              <FormError message={error} />
            </div>
          </DialogBody>
        ) : error ? (
          <DialogBody>
            <FormError message={error} />
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant={deleting ? "destructive" : "primary"} loading={pending} onClick={confirm}>
            {alreadyDisconnected ? "Delete history" : deleting ? "Disconnect and delete" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
