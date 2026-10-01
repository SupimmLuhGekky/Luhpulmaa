"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useFormat } from "@/components/providers/format-provider";
import { formatDateTime } from "@/lib/dates";
import { undoImportAction } from "@/app/actions/import";

export interface ImportBatchItem {
  id: string;
  fileName: string | null;
  importedCount: number;
  duplicateCount: number;
  createdAt: string;
  account: { id: string; name: string };
  remaining: number;
}

/** Recent imports with a way to take one back. */
export function ImportHistory({ batches }: { batches: ImportBatchItem[] }) {
  const router = useRouter();
  const f = useFormat();
  const [target, setTarget] = React.useState<ImportBatchItem | null>(null);
  if (!batches.length) return null;
  return (
    <Card>
      <CardHeading title="Recent imports" description="Undo an import to remove exactly the transactions it added." />
      <ul className="divide-y divide-border border-t border-border">
        {batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{b.fileName ?? "CSV file"}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(b.createdAt, f.timeZone, f.locale)} ·{" "}
                <Link href={`/transactions?account=${b.account.id}`} className="hover:underline">
                  {b.account.name}
                </Link>{" "}
                · {b.importedCount.toLocaleString(f.locale)} added{b.duplicateCount ? `, ${b.duplicateCount.toLocaleString(f.locale)} already there` : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" disabled={b.remaining === 0} onClick={() => setTarget(b)}>
              {b.remaining === 0 ? "Nothing to undo" : "Undo"}
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Undo this import?"
        description={target ? `This removes the ${target.remaining.toLocaleString(f.locale)} ${target.remaining === 1 ? "transaction" : "transactions"} added from ${target.fileName ?? "this file"}, including any notes or categories you set on them.` : undefined}
        confirmLabel="Undo import"
        destructive
        onConfirm={async () => {
          if (!target) return;
          const res = await undoImportAction({ batchId: target.id });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success(`Removed ${res.data.removed} ${res.data.removed === 1 ? "transaction" : "transactions"}`);
          setTarget(null);
          router.refresh();
        }}
      />
    </Card>
  );
}
