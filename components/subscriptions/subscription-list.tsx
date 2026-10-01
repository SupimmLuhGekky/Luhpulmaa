"use client";

import type { Frequency } from "@prisma/client";
import { Ban, Bell, BellOff, MoreHorizontal, Pause, Pencil, Play, Plus, RotateCcw, Trash2, TrendingDown, TrendingUp, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import { REMINDER_OPTIONS, reminderLabel, reminderValue } from "@/components/bills/status";
import { relativeDay } from "@/components/bills/day-panel";
import { FREQUENCY_LABELS, FREQUENCY_SHORT } from "@/lib/dates/schedule";
import { cn } from "@/lib/utils";
import { useSubscriptionActions } from "./subscription-actions";
import { STATUS_LABELS, type SubscriptionRow } from "./types";

function PriceChange({ change }: { change: NonNullable<SubscriptionRow["priceChange"]> }) {
  const fmt = useFormat();
  const up = change.currentCents > change.previousCents;
  const diff = Math.abs(change.currentCents - change.previousCents);
  return (
    <Badge variant={up ? "warning" : "info"}>
      {up ? <TrendingUp aria-hidden /> : <TrendingDown aria-hidden />}
      {up ? "Price up" : "Price down"} {fmt.money(diff)}
    </Badge>
  );
}

function Badges({ sub, isBill }: { sub: SubscriptionRow; isBill: boolean }) {
  if (sub.status === "ACTIVE" && !sub.priceChange && !isBill) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {sub.status !== "ACTIVE" ? <Badge variant={sub.status === "PAUSED" ? "neutral" : "outline"}>{STATUS_LABELS[sub.status]}</Badge> : null}
      {sub.priceChange ? <PriceChange change={sub.priceChange} /> : null}
      {isBill ? <Badge variant="neutral">Also a bill</Badge> : null}
    </span>
  );
}

/** Secondary facts under the name: category, account and any price change. */
function details(sub: SubscriptionRow, money: (c: number) => string, date: (d: string) => string) {
  return [
    sub.category?.name ?? null,
    sub.account?.name ?? null,
    sub.priceChange ? `was ${money(sub.priceChange.previousCents)} before ${date(sub.priceChange.changedOn)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ReminderMenu({ sub }: { sub: SubscriptionRow }) {
  const { setReminder, isPending } = useSubscriptionActions();
  if (sub.status !== "ACTIVE") return <span className="text-xs text-muted-foreground">Off while {sub.status === "PAUSED" ? "paused" : "cancelled"}</span>;
  const label = reminderLabel(sub.reminderDaysBefore);
  const custom = reminderValue(sub.reminderDaysBefore);
  const options = REMINDER_OPTIONS.some((o) => o.value === custom) ? REMINDER_OPTIONS : [...REMINDER_OPTIONS, { value: custom, label }];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground [&_svg]:size-3.5" disabled={isPending(sub.id)} aria-label={`Reminder for ${sub.name}: ${label}. Change reminder`}>
          {sub.reminderDaysBefore === null ? <BellOff /> : <Bell />}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Remind me</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={custom} onValueChange={(v) => setReminder(sub, v === "none" ? null : Number(v))}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SubscriptionMenu({ sub }: { sub: SubscriptionRow }) {
  const a = useSubscriptionActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${sub.name}`} disabled={a.isPending(sub.id)}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => a.edit(sub)}>
          <Pencil /> Edit
        </DropdownMenuItem>
        {sub.status === "ACTIVE" ? (
          <DropdownMenuItem onSelect={() => a.setStatus(sub, "PAUSED")}>
            <Pause /> Pause
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => a.setStatus(sub, "ACTIVE")}>
            {sub.status === "PAUSED" ? <Play /> : <RotateCcw />} {sub.status === "PAUSED" ? "Resume" : "Mark as active"}
          </DropdownMenuItem>
        )}
        {sub.status !== "CANCELLED" ? (
          <DropdownMenuItem onSelect={() => a.setStatus(sub, "CANCELLED")}>
            <Ban /> Mark as cancelled
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {sub.recurringId ? (
          <DropdownMenuItem onSelect={() => a.unmark(sub)}>
            <Unlink /> Not a subscription
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem destructive onSelect={() => a.remove(sub)}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Price({ sub, className }: { sub: SubscriptionRow; className?: string }) {
  const fmt = useFormat();
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {fmt.money(sub.amountCents)}
      <span className="text-xs font-normal text-muted-foreground">{FREQUENCY_SHORT[sub.frequency as Frequency]}</span>
    </span>
  );
}

function NextCharge({ sub }: { sub: SubscriptionRow }) {
  const fmt = useFormat();
  if (sub.status !== "ACTIVE") return <span className="text-muted-foreground">—</span>;
  if (!sub.nextChargeDate) return <span className="text-muted-foreground">Not set</span>;
  const rel = relativeDay(sub.nextChargeDate, fmt.today);
  return (
    <span className="whitespace-nowrap">
      {fmt.date(sub.nextChargeDate, "monthDay")}
      {rel ? <span className="block text-xs text-muted-foreground">{rel}</span> : null}
    </span>
  );
}

/** One group of subscriptions: a table from `md` up, stacked rows on phones. */
export function SubscriptionList({ title, description, rows, billSeries, action, muted }: {
  title: string;
  description?: string;
  rows: SubscriptionRow[];
  /** Recurring series that are also tracked as bills. */
  billSeries: Set<string>;
  action?: React.ReactNode;
  muted?: boolean;
}) {
  const fmt = useFormat();
  const money = (c: number) => fmt.money(c);
  const date = (d: string) => fmt.date(d, "monthDay");
  return (
    <Card className="min-w-0">
      <CardHeading title={title} description={description} action={action} />
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Subscription</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Per month</TableHead>
              <TableHead>Next charge</TableHead>
              <TableHead>Reminder</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const info = details(s, money, date);
              return (
                <TableRow key={s.id}>
                  <TableCell className="max-w-96">
                    <div className="flex min-w-0 items-center gap-3">
                      <CategoryIcon icon={s.category?.icon ?? "repeat"} color={s.category?.color ?? "#64748b"} size="sm" className={cn(muted && "opacity-60")} />
                      <div className="min-w-0">
                        <p className={cn("truncate font-medium", muted ? "text-muted-foreground" : "text-foreground")}>{s.name}</p>
                        {info ? <p className="truncate text-xs text-muted-foreground">{info}</p> : null}
                      </div>
                      <Badges sub={s} isBill={Boolean(s.recurringId && billSeries.has(s.recurringId))} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Price sub={s} />
                  </TableCell>
                  <TableCell className="tabular hidden text-right text-muted-foreground lg:table-cell">{s.frequency === "MONTHLY" ? "—" : fmt.money(s.monthlyCents)}</TableCell>
                  <TableCell>
                    <NextCharge sub={s} />
                  </TableCell>
                  <TableCell>
                    <ReminderMenu sub={s} />
                  </TableCell>
                  <TableCell className="w-12">
                    <SubscriptionMenu sub={s} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-border border-t border-border md:hidden">
        {rows.map((s) => {
          const rel = s.status === "ACTIVE" && s.nextChargeDate ? relativeDay(s.nextChargeDate, fmt.today) : null;
          const next = s.status === "ACTIVE" && s.nextChargeDate ? `Next ${rel ? rel.toLowerCase() : fmt.date(s.nextChargeDate, "monthDay")}` : null;
          return (
            <li key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3">
              <CategoryIcon icon={s.category?.icon ?? "repeat"} color={s.category?.color ?? "#64748b"} size="sm" className={cn(muted && "opacity-60")} />
              <div className="min-w-0">
                <p className={cn("truncate text-sm font-medium", muted ? "text-muted-foreground" : "text-foreground")}>{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">{[FREQUENCY_LABELS[s.frequency as Frequency], next, s.category?.name].filter(Boolean).join(" · ")}</p>
              </div>
              <Price sub={s} className="text-sm font-semibold text-foreground" />
              <div className="col-span-2 col-start-2 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <Badges sub={s} isBill={Boolean(s.recurringId && billSeries.has(s.recurringId))} />
                <div className="ml-auto flex items-center gap-1">
                  <ReminderMenu sub={s} />
                  <SubscriptionMenu sub={s} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function AddSubscriptionButton({ variant = "primary", size = "md" }: { variant?: "primary" | "outline"; size?: "sm" | "md" }) {
  const { add } = useSubscriptionActions();
  return (
    <Button variant={variant} size={size} onClick={add}>
      <Plus /> Add subscription
    </Button>
  );
}
