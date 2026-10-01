"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  BellOff,
  CalendarClock,
  Check,
  CheckCheck,
  Inbox,
  Mail,
  MailOpen,
  MoreHorizontal,
  PiggyBank,
  Receipt,
  Repeat,
  ShieldCheck,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { useFormat } from "@/components/providers/format-provider";
import { daysBetween, dateInZone, formatDate, type LocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  deleteNotificationsAction,
  listNotificationsAction,
  markAllNotificationsReadAction,
  setNotificationsReadAction,
  type NotificationRow,
} from "@/app/actions/notifications";

export type NotificationFilter = "all" | "unread";

const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  BUDGET_WARNING: { label: "Budget", icon: PiggyBank },
  GOAL_PROGRESS: { label: "Goal", icon: Target },
  GOAL_DEADLINE: { label: "Goal deadline", icon: CalendarClock },
  UPCOMING_BILL: { label: "Bill", icon: Receipt },
  SUBSCRIPTION: { label: "Subscription", icon: Repeat },
  LARGE_TRANSACTION: { label: "Large transaction", icon: TrendingUp },
  SYNC_FAILURE: { label: "Account sync", icon: AlertTriangle },
  PAYDAY: { label: "Payday", icon: Wallet },
  AUTOMATION: { label: "Automation", icon: Workflow },
  SYSTEM: { label: "Account & security", icon: ShieldCheck },
};

const SEVERITY_TILE: Record<string, string> = {
  INFO: "bg-info-soft text-info",
  SUCCESS: "bg-positive-soft text-positive",
  WARNING: "bg-warning-soft text-warning",
  CRITICAL: "bg-danger-soft text-danger",
};

const SEVERITY_LABEL: Record<string, string> = { WARNING: "Warning", CRITICAL: "Important" };

interface Counts {
  total: number;
  unread: number;
}

function dayLabel(day: LocalDate, today: LocalDate, locale: string): string {
  const diff = daysBetween(day, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return formatDate(day, "weekdayShort", locale);
  return formatDate(day, day.slice(0, 4) === today.slice(0, 4) ? "weekdayShort" : "medium", locale);
}

export function NotificationCenter({ initial, filter }: { initial: { items: NotificationRow[]; nextCursor: string | null; counts: Counts }; filter: NotificationFilter }) {
  const router = useRouter();
  const fmt = useFormat();
  const [items, setItems] = React.useState(initial.items);
  const [nextCursor, setNextCursor] = React.useState(initial.nextCursor);
  const [counts, setCounts] = React.useState(initial.counts);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string[] | null>(null);

  const timeFormat = React.useMemo(() => new Intl.DateTimeFormat(fmt.locale, { timeZone: fmt.timeZone, hour: "numeric", minute: "2-digit" }), [fmt.locale, fmt.timeZone]);

  const groups = React.useMemo(() => {
    const out: { day: LocalDate; items: NotificationRow[] }[] = [];
    for (const n of items) {
      const day = dateInZone(new Date(n.createdAt), fmt.timeZone);
      const last = out.at(-1);
      if (last && last.day === day) last.items.push(n);
      else out.push({ day, items: [n] });
    }
    return out;
  }, [items, fmt.timeZone]);

  const selection = [...selected].filter((id) => items.some((n) => n.id === id));
  const allSelected = items.length > 0 && selection.length === items.length;

  const toggleSelected = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const setRead = async (ids: string[], read: boolean) => {
    if (!ids.length) return;
    setBusy(true);
    const res = await setNotificationsReadAction({ ids, read });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setItems((list) => list.map((n) => (ids.includes(n.id) ? { ...n, read } : n)));
    setCounts(res.data);
    setSelected(new Set());
  };

  const markAll = async () => {
    setBusy(true);
    const res = await markAllNotificationsReadAction({});
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setCounts(res.data);
    toast.success("All caught up");
  };

  const remove = async (ids: string[]) => {
    const res = await deleteNotificationsAction({ ids });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setItems((list) => list.filter((n) => !ids.includes(n.id)));
    setCounts(res.data);
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
    setConfirmDelete(null);
    toast.success(ids.length === 1 ? "Notification deleted" : `${ids.length} notifications deleted`);
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    const res = await listNotificationsAction({ filter, cursor: nextCursor });
    setLoadingMore(false);
    if (!res.ok) {
      toast.error("Couldn't load more notifications", { description: res.error.message });
      return;
    }
    setItems((list) => [...list, ...res.data.items.filter((n) => !list.some((x) => x.id === n.id))]);
    setNextCursor(res.data.nextCursor);
    setCounts(res.data.counts);
  };

  const open = (n: NotificationRow) => {
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setCounts((c) => ({ ...c, unread: Math.max(0, c.unread - 1) }));
      void setNotificationsReadAction({ ids: [n.id], read: true });
    }
  };

  const changeFilter = (value: NotificationFilter) => {
    router.push(value === "unread" ? "/notifications?filter=unread" : "/notifications", { scroll: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        {selection.length ? (
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Selected notifications">
            <span className="text-sm font-medium text-foreground">{selection.length} selected</span>
            <Button size="sm" variant="outline" onClick={() => setRead(selection, true)} disabled={busy}>
              <MailOpen /> Mark read
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRead(selection, false)} disabled={busy}>
              <Mail /> Mark unread
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(selection)} disabled={busy} className="text-danger">
              <Trash2 /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X /> Cancel
            </Button>
          </div>
        ) : (
          <Segmented<NotificationFilter>
            aria-label="Show"
            value={filter}
            onChange={changeFilter}
            options={[
              { value: "all", label: <span className="tabular">All · {counts.total}</span> },
              { value: "unread", label: <span className="tabular">Unread · {counts.unread}</span> },
            ]}
          />
        )}
        {!selection.length ? (
          <Button size="sm" variant="ghost" onClick={markAll} disabled={busy || counts.unread === 0}>
            <CheckCheck /> Mark all as read
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          {filter === "unread" && counts.total > 0 ? (
            <EmptyState
              icon={CheckCheck}
              title="No unread notifications"
              description="You're all caught up."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/notifications">Show all notifications</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Inbox}
              title="No notifications yet"
              description="Budget alerts, bill reminders, goal milestones and sync problems will show up here."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/settings/notifications">Choose what you hear about</Link>
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <div className="flex items-center gap-3 border-b border-border bg-subtle px-4 py-2">
            <Checkbox
              checked={allSelected ? true : selection.length ? "indeterminate" : false}
              onCheckedChange={(v) => setSelected(v === true ? new Set(items.map((n) => n.id)) : new Set())}
              aria-label={allSelected ? "Clear selection" : "Select all shown notifications"}
            />
            <span className="text-xs text-muted-foreground">
              {items.length === counts.total || filter === "unread" ? `${items.length} shown` : `${items.length} of ${counts.total} shown`}
            </span>
          </div>
          {groups.map((g) => (
            <section key={g.day} aria-label={dayLabel(g.day, fmt.today, fmt.locale)}>
              <h2 className="border-b border-border px-4 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dayLabel(g.day, fmt.today, fmt.locale)}</h2>
              <ul className="divide-y divide-border">
                {g.items.map((n) => {
                  const meta = TYPE_META[n.type] ?? { label: "Notification", icon: Inbox };
                  const Icon = meta.icon;
                  const isSelected = selected.has(n.id);
                  return (
                    <li key={n.id} className={cn("group relative flex gap-3 px-4 py-3.5 transition-colors", !n.read && "bg-primary-soft/30", isSelected && "bg-accent")}>
                      <Checkbox checked={isSelected} onCheckedChange={(v) => toggleSelected(n.id, v === true)} aria-label={`Select “${n.title}”`} className="mt-2.5" />
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", SEVERITY_TILE[n.severity] ?? SEVERITY_TILE.INFO)} aria-hidden>
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-start gap-2">
                          {n.href ? (
                            <Link href={n.href} onClick={() => open(n)} className={cn("min-w-0 text-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring", !n.read && "font-semibold")}>
                              {n.title}
                            </Link>
                          ) : (
                            <span className={cn("min-w-0 text-sm text-foreground", !n.read && "font-semibold")}>{n.title}</span>
                          )}
                          {!n.read ? (
                            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" role="img" />
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">{n.body}</p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <time dateTime={n.createdAt} suppressHydrationWarning>
                            {timeFormat.format(new Date(n.createdAt))}
                          </time>
                          <span aria-hidden>·</span>
                          <span>{meta.label}</span>
                          {SEVERITY_LABEL[n.severity] ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className={n.severity === "CRITICAL" ? "font-medium text-danger" : "font-medium text-warning"}>{SEVERITY_LABEL[n.severity]}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="-mr-1.5 shrink-0" aria-label={`Actions for “${n.title}”`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {n.read ? (
                            <DropdownMenuItem onSelect={() => setRead([n.id], false)}>
                              <Mail /> Mark as unread
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => setRead([n.id], true)}>
                              <Check /> Mark as read
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setConfirmDelete([n.id])}>
                            <Trash2 /> Delete…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {nextCursor ? (
            <div className="border-t border-border p-3 text-center">
              <Button variant="ghost" size="sm" onClick={loadMore} loading={loadingMore}>
                Load older notifications
              </Button>
            </div>
          ) : items.length > 8 ? (
            <p className="flex items-center justify-center gap-1.5 border-t border-border p-3 text-xs text-muted-foreground">
              <BellOff className="size-3.5" aria-hidden /> That&apos;s everything.
            </p>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={confirmDelete && confirmDelete.length > 1 ? `Delete ${confirmDelete.length} notifications?` : "Delete this notification?"}
        description="Deleted notifications can't be recovered. What they were about stays in Harbour."
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDelete && remove(confirmDelete)}
      />
    </div>
  );
}
