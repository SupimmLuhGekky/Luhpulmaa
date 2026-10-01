"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Notice } from "@/components/shared/notice";

/** What a finished bank link reports, for every provider. */
export interface LinkOutcome {
  institution: string;
  accounts: number | null;
  added: number;
  /** The connection was saved but the import after it failed (safe message). */
  warning: string | null;
  reconnected: boolean;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function LinkSummary({ outcome, actions }: { outcome: LinkOutcome; actions?: ReactNode }) {
  return (
    <div className="rounded-xl border border-positive/25 bg-positive-soft p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {outcome.institution} {outcome.reconnected ? "is reconnected" : "is connected"}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {outcome.accounts !== null ? `${plural(outcome.accounts, "account")} · ` : ""}
            {outcome.added === 0 ? "no new transactions" : `${plural(outcome.added, "new transaction")} imported`}
          </p>
          {outcome.warning ? (
            <Notice tone="warning" className="mt-3" title="The import didn't finish">
              {outcome.warning} Harbour will try again on the next sync.
            </Notice>
          ) : null}
          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ImportingStatus({ institution }: { institution: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-subtle p-4">
      <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">Importing accounts and transactions…</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{institution ? `From ${institution}. ` : ""}This can take a little while for a long history. Keep this page open.</p>
      </div>
    </div>
  );
}
