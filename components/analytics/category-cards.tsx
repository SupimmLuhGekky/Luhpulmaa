"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import type { Analytics } from "@/lib/analytics/service";
import { cn } from "@/lib/utils";
import { formatDateRange, shareLabel, transactionsHref } from "./format";
import { ANALYTICS_COLORS } from "./income-spending-card";

const SHOWN = 8;

export function CardHeading({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function ShowMore({ total, shown, expanded, onToggle, noun }: { total: number; shown: number; expanded: boolean; onToggle: () => void; noun: string }) {
  if (total <= shown) return null;
  return (
    <Button variant="ghost" size="sm" className="mt-2 -ml-2 text-primary" onClick={onToggle} aria-expanded={expanded}>
      {expanded ? "Show fewer" : `Show all ${total} ${noun}`}
    </Button>
  );
}

/** A thin bar for a value relative to the largest one in the list (decorative: the number is in the text). */
export function ValueBar({ value, max, color, className }: { value: number; max: number; color: string; className?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 1.5 : 0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

/** Spending per category for the period: amount, share of the total and a bar on one scale. */
export function CategoryBreakdownCard({ data, accountParam, className }: { data: Analytics; accountParam?: string; className?: string }) {
  const fmt = useFormat();
  const [all, setAll] = React.useState(false);
  const rows = data.categoryBreakdown;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const max = rows[0]?.spending ?? 0;

  return (
    <Card className={cn("min-w-0 p-5", className)}>
      <CardHeading
        title="Spending by category"
        description={rows.length ? `${rows.length} ${rows.length === 1 ? "category" : "categories"} · ${fmt.money(data.metrics.spending)} in total` : undefined}
      />
      {rows.length ? (
        <>
          <ul className="mt-3 space-y-0.5">
            {shown.map((c) => (
              <li key={c.categoryId ?? "uncategorized"}>
                <Link
                  href={transactionsHref(data.range, { category: c.categoryId ?? "uncategorized", account: accountParam })}
                  className="-mx-2 block rounded-lg px-2 py-2 outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2.5">
                    <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.name}</span>
                    <span className="tabular shrink-0 text-sm font-medium text-foreground">{fmt.money(c.spending)}</span>
                    <span className="tabular w-9 shrink-0 text-right text-xs text-muted-foreground">
                      <span className="sr-only">, </span>
                      {shareLabel(c.shareBps)}
                      <span className="sr-only"> of spending</span>
                    </span>
                  </span>
                  <ValueBar value={c.spending} max={max} color={ANALYTICS_COLORS.spending} className="ml-[2.125rem] mt-1.5" />
                </Link>
              </li>
            ))}
          </ul>
          <ShowMore total={rows.length} shown={SHOWN} expanded={all} onToggle={() => setAll((v) => !v)} noun="categories" />
        </>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">No spending in this period.</p>
      )}
    </Card>
  );
}

/**
 * Categories whose spending changed most against the comparison period, including
 * categories that dropped to zero. Two bars per row (this period, before) on one scale.
 */
export function CategoryChangesCard({ data, className }: { data: Analytics; className?: string }) {
  const fmt = useFormat();
  const [all, setAll] = React.useState(false);
  const r = data.range;
  const rows = data.categoryChanges;
  const shown = all ? rows : rows.slice(0, 6);
  const max = Math.max(0, ...rows.map((c) => Math.max(c.spending, c.previous)));
  const before = formatDateRange(r.previousFrom, r.previousTo, fmt.locale);

  return (
    <Card className={cn("min-w-0 p-5", className)}>
      <CardHeading title="Biggest changes" description={r.comparison === "none" ? undefined : <>Compared with {r.comparisonLabel}</>} />
      {r.comparison === "none" ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {r.dataSince
            ? `There are no transactions from ${before} to compare with. ${data.filters.scoped ? "Transactions matching these filters start" : "Your transactions start"} on ${fmt.date(r.dataSince, "medium")}.`
            : "There are no earlier transactions to compare with."}
        </p>
      ) : rows.length ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Bar legend">
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: ANALYTICS_COLORS.spending }} aria-hidden />
              {r.label}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: ANALYTICS_COLORS.previous }} aria-hidden />
              {before}
            </li>
          </ul>
          <ul className="mt-2 divide-y divide-border">
            {shown.map((c) => {
              const up = c.delta > 0;
              const Icon = up ? ArrowUpRight : ArrowDownRight;
              return (
                <li key={c.categoryId ?? "uncategorized"} className="py-2.5">
                  <div className="flex items-center gap-2.5">
                    <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.name}</span>
                    <span className="tabular flex shrink-0 items-center gap-0.5 text-sm font-medium text-foreground">
                      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                      {fmt.money(Math.abs(c.delta))}
                      <span className="sr-only">{up ? " more" : " less"}</span>
                    </span>
                  </div>
                  <div className="ml-[2.125rem] mt-1.5 space-y-1">
                    <ValueBar value={c.spending} max={max} color={ANALYTICS_COLORS.spending} />
                    <ValueBar value={c.previous} max={max} color={ANALYTICS_COLORS.previous} />
                  </div>
                  <p className="tabular ml-[2.125rem] mt-1 text-xs text-muted-foreground">
                    {fmt.money(c.spending)} <span className="sr-only">this period</span>
                    <span aria-hidden> vs </span>
                    <span className="sr-only">, compared with </span>
                    {fmt.money(c.previous)}
                    {c.previous === 0 ? " (new)" : c.spending === 0 ? " (none this period)" : ""}
                  </p>
                </li>
              );
            })}
          </ul>
          <ShowMore total={rows.length} shown={6} expanded={all} onToggle={() => setAll((v) => !v)} noun="changes" />
          {r.comparison === "partial" && r.dataSince ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {data.filters.scoped ? "Transactions matching these filters start" : "Your transactions start"} on {fmt.date(r.dataSince, "medium")}, partway through the comparison period.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">Spending per category is the same as {r.comparisonLabel}.</p>
      )}
    </Card>
  );
}
