"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, History, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { useFormat } from "@/components/providers/format-provider";
import { formatDateTime, formatMonthKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { listAutomationRunsAction } from "@/app/actions/automations";
import type { AutomationRunDTO } from "@/lib/automation/service";

const EVENT_LABELS: Record<string, string> = {
  month: "Monthly run",
  week: "Weekly run",
  sub: "New subscription detected",
  budget: "Budget threshold reached",
};

/** What a run without a transaction was for: "October 2026", "Week of Sep 27", … */
function eventText(r: AutomationRunDTO, fmt: ReturnType<typeof useFormat>) {
  if (r.event === "month" && r.period && /^\d{4}-\d{2}$/.test(r.period)) return `Monthly run · ${formatMonthKey(r.period, fmt.locale)}`;
  if (r.event === "week" && r.period && /^\d{4}-\d{2}-\d{2}$/.test(r.period)) return `Weekly run · week of ${fmt.date(r.period, "monthDay")}`;
  return EVENT_LABELS[r.event] ?? "Event";
}

/** Sentence-case a run summary such as "set category Transportation; planned $12.00 to goal". */
function summaryText(summary: string | null) {
  if (!summary) return "Ran";
  const parts = summary.split("; ").filter(Boolean);
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function RunHistory({
  initial,
  automationId,
  showAutomation = false,
  emptyText = "Runs appear here each time an automation does something.",
}: {
  initial: { items: AutomationRunDTO[]; nextCursor: string | null };
  automationId?: string;
  showAutomation?: boolean;
  emptyText?: string;
}) {
  const fmt = useFormat();
  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.nextCursor);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setItems(initial.items);
    setCursor(initial.nextCursor);
  }, [initial]);

  const more = async () => {
    if (!cursor) return;
    setLoading(true);
    const res = await listAutomationRunsAction({ automationId, cursor });
    setLoading(false);
    if (!res.ok) {
      toast.error("Couldn't load older runs", { description: res.error.message });
      return;
    }
    setItems((list) => [...list, ...res.data.items.filter((r) => !list.some((x) => x.id === r.id))]);
    setCursor(res.data.nextCursor);
  };

  if (!items.length) return <EmptyState compact icon={History} title="No runs yet" description={emptyText} />;

  return (
    <div>
      <ol className="divide-y divide-border">
        {items.map((r) => {
          const ok = r.status === "SUCCESS";
          const ranAt = (
            <time dateTime={r.executedAt} suppressHydrationWarning>
              {formatDateTime(r.executedAt, fmt.timeZone, fmt.locale)}
            </time>
          );
          return (
            <li key={r.id} className="flex gap-3 py-3 first:pt-0">
              {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-label="Done" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Failed" />}
              <div className="min-w-0 flex-1">
                {showAutomation ? (
                  <Link href={`/automations/${r.automation.id}`} className="text-[13px] font-medium text-foreground underline-offset-4 hover:underline">
                    {r.automation.name}
                  </Link>
                ) : null}
                <p className={cn("text-[13px]", showAutomation ? "text-muted-foreground" : "text-foreground", !ok && "text-danger")}>{ok ? summaryText(r.summary) : (r.summary ?? "Failed")}</p>
                <p className="mt-0.5 flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                  {r.transaction ? (
                    <>
                      <Link href={`/transactions?txn=${r.transaction.id}`} className="min-w-0 max-w-[16rem] truncate underline-offset-4 hover:text-foreground hover:underline">
                        {r.transaction.label}
                      </Link>
                      <span aria-hidden>·</span>
                      <span className="tabular">{fmt.money(r.transaction.amountCents)}</span>
                      <span aria-hidden>·</span>
                      <span>{fmt.date(r.transaction.date)}</span>
                    </>
                  ) : (
                    <span>{eventText(r, fmt)}</span>
                  )}
                </p>
                {/* The run time: its own line in narrow lists, right-aligned in the wide history tab. */}
                <p className={cn("mt-0.5 text-xs text-muted-foreground", !showAutomation && "sm:hidden")}>Ran {ranAt}</p>
              </div>
              {!showAutomation ? <p className="hidden shrink-0 pt-px text-xs text-muted-foreground sm:block">Ran {ranAt}</p> : null}
            </li>
          );
        })}
      </ol>
      {cursor ? (
        <div className="pt-2 text-center">
          <Button variant="ghost" size="sm" onClick={more} loading={loading}>
            Load older runs
          </Button>
        </div>
      ) : null}
    </div>
  );
}
