"use client";

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useFormat } from "@/components/providers/format-provider";
import type { Analytics } from "@/lib/analytics/service";
import { cn } from "@/lib/utils";
import { CardHeading, ValueBar } from "./category-cards";
import { transactionsHref } from "./format";
import { ANALYTICS_COLORS } from "./income-spending-card";

/** Where the most money went in the period, by merchant (top 10), with the number of purchases. */
export function MerchantsCard({ data, accountParam, className }: { data: Analytics; accountParam?: string; className?: string }) {
  const fmt = useFormat();
  const rows = data.merchants;
  const max = rows[0]?.spending ?? 0;
  return (
    <Card className={cn("min-w-0 p-5", className)}>
      <CardHeading title="Top merchants" description={rows.length ? `By spending, ${data.range.periodPhrase}` : undefined} />
      {rows.length ? (
        <ol className="mt-3 space-y-0.5">
          {rows.map((m, i) => (
            <li key={m.merchant}>
              <Link
                href={transactionsHref(data.range, { q: m.merchant === "Unknown" ? undefined : m.merchant, account: accountParam })}
                className="-mx-2 block rounded-lg px-2 py-2 outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-baseline gap-2.5">
                  <span className="tabular w-5 shrink-0 text-right text-xs text-muted-foreground" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{m.merchant}</span>
                  <span className="tabular shrink-0 text-sm font-medium text-foreground">
                    <span className="sr-only">: </span>
                    {fmt.money(m.spending)}
                  </span>
                </span>
                <span className="ml-[1.875rem] mt-1.5 flex items-center gap-3">
                  <ValueBar value={m.spending} max={max} color={ANALYTICS_COLORS.spending} className="flex-1" />
                  <span className="tabular w-[5.5rem] shrink-0 text-right text-xs text-muted-foreground">
                    <span className="sr-only">, </span>
                    {m.count} {m.count === 1 ? "purchase" : "purchases"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">No spending in this period.</p>
      )}
    </Card>
  );
}
