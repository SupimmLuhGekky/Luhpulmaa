"use client";

import type { Frequency } from "@prisma/client";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import { FREQUENCY_LABELS } from "@/lib/dates/schedule";
import { useSubscriptionActions } from "./subscription-actions";
import type { RecurringCandidate } from "./types";

/** Detected repeating charges that aren't subscriptions, each with "Mark as subscription". */
export function RecurringCandidates({ candidates }: { candidates: RecurringCandidate[] }) {
  const fmt = useFormat();
  const { markRecurring, isPending } = useSubscriptionActions();
  if (!candidates.length) return null;
  return (
    <Card className="min-w-0">
      <CardHeading title="Other repeating charges" description="Found in your transactions. Mark the ones that are subscriptions to include them in your totals." />
      <ul className="divide-y divide-border border-t border-border">
        {candidates.map((c) => (
          <li key={c.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-5">
            <CategoryIcon icon={c.category?.icon ?? "repeat"} color={c.category?.color ?? "#64748b"} size="sm" />
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{c.name}</span>
                {c.isBill ? <Badge variant="neutral">Tracked as a bill</Badge> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[FREQUENCY_LABELS[c.frequency as Frequency], `${c.occurrenceCount} charges so far`, c.nextExpectedDate ? `next around ${fmt.date(c.nextExpectedDate, "monthDay")}` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="tabular text-right text-sm font-semibold text-foreground">
              {fmt.money(Math.abs(c.lastAmountCents))}
              <span className="block text-xs font-normal text-muted-foreground">last charge</span>
            </span>
            <Button variant="outline" size="sm" className="col-span-2 col-start-2 justify-self-start sm:col-span-1 sm:col-start-auto" onClick={() => markRecurring(c)} loading={isPending(c.id)}>
              {isPending(c.id) ? null : <Plus />} Mark as subscription<span className="sr-only">: {c.name}</span>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
