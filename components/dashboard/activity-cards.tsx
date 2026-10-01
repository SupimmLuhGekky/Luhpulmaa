"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AreaChart } from "@/components/charts/area-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { WidgetCard, WidgetEmpty } from "./widget-card";

export interface SpendingBreakdownData {
  label: string;
  total: number;
  categories: { categoryId: string | null; name: string; color: string; icon: string; spending: number; previous: number; shareBps: number }[];
}

const MAX_SLICES = 5;

export function SpendingBreakdownCard({ data }: { data: SpendingBreakdownData }) {
  const f = useFormat();
  const top = data.categories.slice(0, MAX_SLICES);
  const rest = data.categories.slice(MAX_SLICES);
  const restTotal = rest.reduce((a, c) => a + c.spending, 0);
  const slices = [...top.map((c) => ({ name: c.name, value: c.spending, color: c.color })), ...(restTotal > 0 ? [{ name: `${rest.length} more`, value: restTotal, color: "var(--muted-foreground)" }] : [])];
  return (
    <WidgetCard title="Spending by category" description={data.label} href="/analytics" linkLabel="Analytics">
      {!data.categories.length ? (
        <WidgetEmpty>No spending recorded yet this period.</WidgetEmpty>
      ) : (
        <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,10rem)_1fr] md:grid-cols-1 lg:grid-cols-[minmax(0,10rem)_1fr]">
          <DonutChart label={`Spending by category, ${data.label.toLowerCase()}`} data={slices} height={160} centerLabel="Spent" />
          <ul className="space-y-2">
            {top.map((c) => {
              return (
                <li key={c.categoryId ?? "uncategorized"} className="flex items-center gap-2 text-[13px]">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                  <Link href={`/transactions?category=${c.categoryId ?? "uncategorized"}`} className="min-w-0 flex-1 truncate hover:underline">
                    {c.name}
                  </Link>
                  <span className="tabular font-medium">{f.money(c.spending, { wholeDollars: true })}</span>
                  <span className="tabular w-10 text-right text-xs text-muted-foreground" title={c.previous > 0 ? `${f.money(c.previous)} on the same dates last month` : undefined}>
                    {Math.round(c.shareBps / 100)}%
                  </span>
                </li>
              );
            })}
            {restTotal > 0 ? (
              <li className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                <span className="flex-1">Other categories</span>
                <span className="tabular">{f.money(restTotal, { wholeDollars: true })}</span>
                <span className="w-10" />
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

export interface CashFlowCardData {
  startingBalance: number;
  endingBalance: number;
  lowestBalance: number;
  lowestBalanceDate: string;
  minimumBuffer: number;
  belowBufferDays: number;
  days: { date: string; balance: number }[];
  upcoming: { date: string; amount: number; label: string; kind: string }[];
}

export function CashFlowCard({ data }: { data: CashFlowCardData }) {
  const f = useFormat();
  const tight = data.lowestBalance < 0 || data.belowBufferDays > 0;
  return (
    <WidgetCard
      title="Cash flow"
      description={
        <span className="inline-flex items-center gap-1.5">
          Next 30 days <Badge variant="outline">Estimate</Badge>
        </span>
      }
      href="/forecast"
      linkLabel="Forecast"
    >
      <div className="grid grid-cols-3 gap-3 text-[13px]">
        <div>
          <p className="text-muted-foreground">Today</p>
          <p className="tabular font-semibold">{f.money(data.startingBalance, { wholeDollars: true })}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Lowest point</p>
          <p className={cn("tabular font-semibold", data.lowestBalance < 0 ? "text-danger" : tight && "text-warning")}>{f.money(data.lowestBalance, { wholeDollars: true })}</p>
          <p className="text-xs text-muted-foreground">{f.date(data.lowestBalanceDate, "monthDay")}</p>
        </div>
        <div>
          <p className="text-muted-foreground">In 30 days</p>
          <p className="tabular font-semibold">{f.money(data.endingBalance, { wholeDollars: true })}</p>
        </div>
      </div>
      <div className="mt-3">
        <AreaChart
          label="Estimated balance for the next 30 days"
          data={data.days}
          xKey="date"
          series={[{ key: "balance", label: "Estimated balance", color: "var(--chart-1)" }]}
          height={170}
          referenceY={data.minimumBuffer > 0 ? { value: data.minimumBuffer, label: "Your buffer" } : undefined}
        />
      </div>
      {data.upcoming.length ? (
        <ul className="mt-3 space-y-1 text-xs">
          {data.upcoming.slice(0, 3).map((e, i) => (
            <li key={`${e.date}:${e.label}:${i}`} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-muted-foreground">
                {f.date(e.date, "monthDay")} · {e.label}
              </span>
              <span className={cn("tabular font-medium", e.amount > 0 && "text-positive")}>{f.money(e.amount, { signed: true })}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">Projected from expected pay, bills, subscriptions and your typical day-to-day spending. Real results will differ.</p>
    </WidgetCard>
  );
}

export interface RecentTransaction {
  id: string;
  date: string;
  merchantName: string;
  amountCents: number;
  isPending: boolean;
  isTransfer: boolean;
  account: { name: string } | null;
  category: { name: string; icon: string; color: string } | null;
}

export function RecentTransactionsCard({ rows }: { rows: RecentTransaction[] }) {
  const f = useFormat();
  return (
    <WidgetCard title="Recent transactions" href="/transactions" linkLabel="All transactions">
      {!rows.length ? (
        <WidgetEmpty
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/transactions/import">Import a CSV</Link>
            </Button>
          }
        >
          No transactions yet. Import a statement from your bank or add one by hand.
        </WidgetEmpty>
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/transactions?txn=${t.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent">
                <CategoryIcon icon={t.category?.icon} color={t.category?.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{t.merchantName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {f.relative(t.date)} · {t.category?.name ?? "Uncategorized"}
                    {t.account ? ` · ${t.account.name}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cn("tabular text-[13px] font-medium", t.amountCents > 0 && !t.isTransfer && "text-positive")}>{f.money(t.amountCents, { signed: t.amountCents > 0 })}</p>
                  {t.isPending ? <p className="text-[11px] text-muted-foreground">Pending</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export interface InsightItem {
  id: string;
  tone: "neutral" | "positive" | "attention";
  text: string;
  basis: string;
}

const toneIcon = { neutral: Lightbulb, positive: CheckCircle2, attention: AlertTriangle } as const;
const toneClass = { neutral: "text-info", positive: "text-positive", attention: "text-warning" } as const;

export function InsightsCard({ items }: { items: InsightItem[] }) {
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <WidgetCard title="Insights" description="Facts from your own transactions" href="/analytics" linkLabel="Analytics">
      {!items.length ? (
        <WidgetEmpty>Insights show up once there are a few weeks of transactions to compare.</WidgetEmpty>
      ) : (
        <ul className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
          {items.slice(0, 4).map((i) => {
            const Icon = toneIcon[i.tone];
            const expanded = open === i.id;
            return (
              <li key={i.id} className="flex gap-2.5 text-[13px]">
                <Icon className={cn("mt-0.5 size-4 shrink-0", toneClass[i.tone])} aria-hidden />
                <div className="min-w-0">
                  <p>{i.text}</p>
                  <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : i.id)}>
                    {expanded ? "Hide how this was calculated" : "How was this calculated?"}
                  </button>
                  {expanded ? <p className="mt-1 text-xs text-muted-foreground">{i.basis}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
