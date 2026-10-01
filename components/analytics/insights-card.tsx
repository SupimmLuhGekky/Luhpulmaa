"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Lightbulb } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useFormat } from "@/components/providers/format-provider";
import type { Analytics } from "@/lib/analytics/service";
import { cn } from "@/lib/utils";
import { CardHeading, ShowMore } from "./category-cards";
import { readableDates } from "./format";

/** Icons only echo the sentence (which says "more", "less" or "exceeded" itself). */
const TONE = {
  neutral: { icon: Lightbulb, cls: "text-info" },
  positive: { icon: CheckCircle2, cls: "text-positive" },
  attention: { icon: AlertTriangle, cls: "text-warning" },
} as const;

const SHOWN = 4;

/**
 * Factual observations calculated from the user's transactions (lib/analytics/insights).
 * They state numbers only, never advice; each one shows how it was calculated.
 */
export function InsightsCard({ data, className }: { data: Analytics; className?: string }) {
  const fmt = useFormat();
  const [all, setAll] = React.useState(false);
  // Changes (favourable or not) first, then the standing facts; otherwise the generator's order.
  const items = [...data.insights].sort((a, b) => Number(a.tone === "neutral") - Number(b.tone === "neutral"));
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <Card className={cn("min-w-0 p-5", className)}>
      <CardHeading title="Insights" description="Facts calculated from your transactions. No advice." />
      {items.length ? (
        <>
          <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3.5 lg:grid-cols-2 xl:grid-cols-1">
            {shown.map((i) => {
              const tone = TONE[i.tone];
              const Icon = tone.icon;
              return (
                <li key={i.id} className="flex gap-2.5">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", tone.cls)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{i.text}</p>
                    <details className="group mt-0.5 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-0.5 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
                        How this was calculated
                      </summary>
                      <p className="mt-1 pl-4 text-xs text-muted-foreground">{readableDates(i.basis, (d) => fmt.date(d, "medium"))}</p>
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>
          <ShowMore total={items.length} shown={SHOWN} expanded={all} onToggle={() => setAll((v) => !v)} noun="insights" />
        </>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">Insights appear once there is spending or income in this period.</p>
      )}
    </Card>
  );
}
