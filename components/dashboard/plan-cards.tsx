"use client";

import Link from "next/link";
import { CalendarClock, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { WidgetCard, WidgetEmpty } from "./widget-card";

export interface BudgetCardData {
  name: string;
  start: string;
  end: string;
  totals: { available: number; spent: number; remaining: number; unbudgetedSpent: number };
  lines: { id: string; name: string; icon: string; color: string; available: number; spent: number; remaining: number; usedBps: number; status: "on_track" | "warning" | "over" }[];
}

const statusTone = { on_track: "primary", warning: "warning", over: "danger" } as const;

/** "Today" → "today", "In 3 days" → "in 3 days", "Oct 5" → "on Oct 5". */
function whenPhrase(relative: string) {
  return /^(Today|Tomorrow|Yesterday|In \d+ days)$/.test(relative) ? relative.toLowerCase() : `on ${relative}`;
}

export function BudgetCard({ data }: { data: BudgetCardData | null }) {
  const f = useFormat();
  if (!data) {
    return (
      <WidgetCard title="Budget" description="This month">
        <WidgetEmpty
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/budget?new=1">Create a budget</Link>
            </Button>
          }
        >
          No budget for this month yet. Start from a template or last month&apos;s spending.
        </WidgetEmpty>
      </WidgetCard>
    );
  }
  const usedPct = data.totals.available > 0 ? Math.round((data.totals.spent * 100) / data.totals.available) : 0;
  const watch = [...data.lines].filter((l) => l.available > 0 || l.spent > 0).sort((a, b) => b.usedBps - a.usedBps).slice(0, 4);
  const over = data.lines.filter((l) => l.status === "over").length;
  return (
    <WidgetCard title="Budget" description={`${f.date(data.start, "monthDay")} – ${f.date(data.end, "monthDay")}`} href="/budget" linkLabel="Budget">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={cn("tabular text-2xl font-semibold tracking-tight", data.totals.remaining < 0 && "text-danger")}>{f.money(data.totals.remaining)}</p>
          <p className="text-[13px] text-muted-foreground">{data.totals.remaining >= 0 ? "left to spend" : "over budget"}</p>
        </div>
        <p className="tabular text-right text-xs text-muted-foreground">
          {f.money(data.totals.spent)} of {f.money(data.totals.available)}
          {over ? (
            <Badge variant="danger" className="ml-1.5">
              {over} over
            </Badge>
          ) : null}
        </p>
      </div>
      <Progress className="mt-2" value={usedPct} label={`${usedPct}% of this month's budget used`} tone={usedPct > 100 ? "danger" : usedPct >= 85 ? "warning" : "primary"} />
      <ul className="mt-4 space-y-3">
        {watch.map((l) => {
          const pct = Math.round(l.usedBps / 100);
          return (
            <li key={l.id}>
              <div className="flex items-center gap-2 text-[13px]">
                <CategoryIcon icon={l.icon} color={l.color} size="sm" />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className={cn("tabular text-xs", l.remaining < 0 ? "font-medium text-danger" : "text-muted-foreground")}>
                  {l.remaining < 0 ? `${f.money(-l.remaining)} over` : `${f.money(l.remaining)} left`}
                </span>
              </div>
              <Progress className="mt-1.5" size="sm" value={pct} label={`${l.name}: ${pct}% used`} tone={statusTone[l.status]} />
            </li>
          );
        })}
      </ul>
      {data.totals.unbudgetedSpent > 0 ? <p className="mt-3 text-xs text-muted-foreground">{f.money(data.totals.unbudgetedSpent)} spent in categories without a budget.</p> : null}
    </WidgetCard>
  );
}

export interface GoalCardItem {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  target: number;
  current: number;
  remaining: number;
  progressBps: number;
  isComplete: boolean;
  isOverdue: boolean;
  daysLeft: number | null;
  requiredMonthly: number | null;
  deadline: string | null;
}

export function GoalsCard({ goals }: { goals: GoalCardItem[] }) {
  const f = useFormat();
  if (!goals.length) {
    return (
      <WidgetCard title="Savings goals">
        <WidgetEmpty
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/goals?new=1">Create a goal</Link>
            </Button>
          }
        >
          Set a goal like an emergency fund or a trip, and Harbour tracks how much to put aside.
        </WidgetEmpty>
      </WidgetCard>
    );
  }
  const saved = goals.reduce((a, g) => a + g.current, 0);
  const target = goals.reduce((a, g) => a + g.target, 0);
  return (
    <WidgetCard title="Savings goals" description={`${f.money(saved)} saved of ${f.money(target)}`} href="/goals" linkLabel="Goals">
      <ul className="space-y-4">
        {goals.slice(0, 4).map((g) => {
          const pct = Math.round(g.progressBps / 100);
          return (
            <li key={g.id}>
              <Link href={`/goals/${g.id}`} className="group block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                <div className="flex items-center gap-2 text-[13px]">
                  <CategoryIcon icon={g.icon ?? "piggy-bank"} color={g.color ?? "#0ea5e9"} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium group-hover:underline">{g.name}</span>
                  <span className="tabular text-xs text-muted-foreground">{pct}%</span>
                </div>
                <Progress className="mt-1.5" size="sm" value={pct} label={`${g.name}: ${pct}% saved`} tone={g.isComplete ? "positive" : g.isOverdue ? "warning" : "primary"} color={g.isComplete || g.isOverdue ? undefined : (g.color ?? undefined)} />
                <p className="tabular mt-1 text-xs text-muted-foreground">
                  {f.money(g.current)} of {f.money(g.target)}
                  {g.isComplete
                    ? " · Reached"
                    : g.isOverdue
                      ? " · Past its target date"
                      : g.requiredMonthly && g.deadline
                        ? ` · ${f.money(g.requiredMonthly)}/month to reach it by ${f.date(g.deadline, "monthYear")}`
                        : ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      {goals.length > 4 ? <p className="mt-3 text-xs text-muted-foreground">And {goals.length - 4} more.</p> : null}
    </WidgetCard>
  );
}

export interface BillsCardData {
  items: { billId: string; name: string; dueDate: string; amountCents: number; isVariableAmount: boolean; autopay: boolean; category: { icon: string; color: string } | null }[];
  nextPayday: string | null;
  dueBeforePayday: number;
  countBeforePayday: number;
}

export function BillsCard({ data }: { data: BillsCardData }) {
  const f = useFormat();
  return (
    <WidgetCard title="Upcoming bills" description="Next 30 days" href="/bills" linkLabel="Bills">
      {!data.items.length ? (
        <WidgetEmpty
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/bills?new=1">Add a bill</Link>
            </Button>
          }
        >
          No unpaid bills in the next 30 days.
        </WidgetEmpty>
      ) : (
        <>
          {data.nextPayday ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-[13px]">
              <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="min-w-0 flex-1">
                {data.countBeforePayday ? (
                  <>
                    <span className="tabular font-semibold">{f.money(data.dueBeforePayday)}</span> due before payday ({f.date(data.nextPayday, "monthDay")})
                  </>
                ) : (
                  <>Nothing due before payday ({f.date(data.nextPayday, "monthDay")})</>
                )}
              </p>
            </div>
          ) : null}
          <ul className="divide-y divide-border">
            {data.items.map((b) => {
              const rel = f.relative(b.dueDate);
              const soon = b.dueDate <= f.today;
              return (
                <li key={`${b.billId}:${b.dueDate}`} className="flex items-center gap-3 py-2">
                  <CategoryIcon icon={b.category?.icon ?? "receipt"} color={b.category?.color ?? "#64748b"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{b.name}</p>
                    <p className={cn("text-xs", soon ? "font-medium text-warning" : "text-muted-foreground")}>
                      {rel}
                      {b.autopay ? " · Autopay" : ""}
                    </p>
                  </div>
                  <span className="tabular text-[13px] font-medium">
                    {b.isVariableAmount ? "≈ " : ""}
                    {f.money(b.amountCents)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

export interface SubscriptionsCardData {
  totals: { monthly: number; yearly: number; count: number };
  upcoming: { id: string; name: string; amountCents: number; nextChargeDate: string | null; category: { icon: string; color: string } | null }[];
}

export function SubscriptionsCard({ data }: { data: SubscriptionsCardData }) {
  const f = useFormat();
  return (
    <WidgetCard title="Subscriptions" description={data.totals.count ? `${data.totals.count} active` : undefined} href="/subscriptions" linkLabel="Manage">
      {!data.totals.count ? (
        <WidgetEmpty>Harbour spots repeating charges like streaming and phone plans once a few months of transactions are in.</WidgetEmpty>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <p className="tabular text-2xl font-semibold tracking-tight">{f.money(data.totals.monthly)}</p>
            <p className="text-[13px] text-muted-foreground">a month</p>
          </div>
          <p className="tabular text-xs text-muted-foreground">{f.money(data.totals.yearly)} a year</p>
          <ul className="mt-3 divide-y divide-border">
            {data.upcoming.slice(0, 4).map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                {s.category ? <CategoryIcon icon={s.category.icon} color={s.category.color} size="sm" /> : <Repeat className="size-4 text-muted-foreground" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.nextChargeDate ? `Next charge ${whenPhrase(f.relative(s.nextChargeDate))}` : "No date yet"}</p>
                </div>
                <span className="tabular text-[13px] font-medium">{f.money(s.amountCents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}
