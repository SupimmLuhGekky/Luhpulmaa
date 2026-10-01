"use client";

import { AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useFormat } from "@/components/providers/format-provider";
import { OVERDUE_LOOKBACK_DAYS } from "@/lib/bills/calendar";
import { useBillActions } from "./bill-actions";
import { OccurrenceItem } from "./occurrence-item";
import type { Occurrence } from "./types";

/** Unpaid bills whose due date has passed (last 60 days). Hidden when there are none. */
export function OverdueBills({ occurrences }: { occurrences: Occurrence[] }) {
  const fmt = useFormat();
  const { resolve } = useBillActions();
  const unpaid = occurrences.filter((o) => !resolve(o).paid);
  if (!unpaid.length) return null;
  const total = unpaid.reduce((s, o) => s + o.amountCents, 0);
  return (
    <Card className="border-danger/30">
      <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
          <AlertCircle className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {unpaid.length === 1 ? "1 bill is overdue" : `${unpaid.length} bills are overdue`} · <span className="tabular">{fmt.money(total)}</span>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Unpaid due dates from the last {OVERDUE_LOOKBACK_DAYS} days. If you already paid, mark them paid to keep your plan accurate.</p>
        </div>
      </div>
      <ul className="divide-y divide-border px-4 pb-1 sm:px-5">
        {unpaid.map((o) => (
          <OccurrenceItem key={`${o.billId}:${o.dueDate}`} occurrence={o} showDate />
        ))}
      </ul>
    </Card>
  );
}
