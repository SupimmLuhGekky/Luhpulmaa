"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Bell, CalendarDays, CheckCheck, FileUp, Landmark, LogOut, Monitor, Moon, Plus, Search, Settings, Sun, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { Logo } from "@/components/shared/logo";
import { formatRelativeTime } from "@/lib/dates";
import { cn, initials } from "@/lib/utils";
import { signOutAction } from "@/app/actions/auth";
import { markNotificationsReadAction, recentNotificationsAction, type NotificationItem } from "@/app/actions/shell";
import { useShell } from "./shell-provider";

export interface TopBarUser {
  firstName: string;
  lastName: string;
  email: string;
  isDemo: boolean;
}

const severityDot: Record<string, string> = { INFO: "bg-info", SUCCESS: "bg-positive", WARNING: "bg-warning", CRITICAL: "bg-danger" };

function NotificationsMenu({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(initialUnread);
  const [items, setItems] = React.useState<NotificationItem[] | null>(null);

  React.useEffect(() => setUnread(initialUnread), [initialUnread]);
  React.useEffect(() => {
    if (!open) return;
    recentNotificationsAction({ take: 8 }).then((res) => {
      if (res.ok) {
        setItems(res.data.items);
        setUnread(res.data.unread);
      }
    });
  }, [open]);

  const openItem = async (n: NotificationItem) => {
    setOpen(false);
    if (!n.read) {
      const res = await markNotificationsReadAction({ ids: [n.id] });
      if (res.ok) setUnread(res.data.unread);
    }
    router.push(n.href ?? "/notifications");
  };

  const markAll = async () => {
    const res = await markNotificationsReadAction({ all: true });
    if (res.ok) {
      setUnread(0);
      setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell />
          {unread ? <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">{unread > 9 ? "9+" : unread}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread ? (
            <Button variant="ghost" size="sm" onClick={markAll}>
              <CheckCheck /> Mark all read
            </Button>
          ) : null}
        </div>
        <ul className="max-h-96 overflow-y-auto py-1">
          {items === null ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</li>
          ) : (
            items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={cn("flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent", !n.read && "bg-primary-soft/40")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : (severityDot[n.severity] ?? "bg-info"))} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-snug">{n.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground/80">{formatRelativeTime(n.createdAt)}</span>
                  </span>
                  {!n.read ? <span className="sr-only">Unread</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-border p-1.5">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/notifications" onClick={() => setOpen(false)}>
              See all notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu({ user }: { user: TopBarUser }) {
  const { theme, setTheme } = useTheme();
  const formRef = React.useRef<HTMLFormElement>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary outline-none ring-ring/40 focus-visible:ring-2" aria-label="Account menu">
          {initials(user.firstName, user.lastName)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">
            {user.firstName} {user.lastName}
          </span>
          <span className="block truncate text-xs">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 size-4 text-muted-foreground" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 size-4 text-muted-foreground" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 size-4 text-muted-foreground" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <form ref={formRef} action={signOutAction}>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }}
          >
            <LogOut /> Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sticky header: search, quick add, notifications and the account menu. */
export function TopBar({ user, unread }: { user: TopBarUser; unread: number }) {
  const { openQuickAdd, openSearch } = useShell();
  const router = useRouter();
  const [mac, setMac] = React.useState(false);
  React.useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="md:hidden" aria-label="Harbour home">
          <Logo />
        </Link>
        <button
          type="button"
          onClick={openSearch}
          className="hidden h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground shadow-soft transition-colors hover:border-ring/50 md:flex"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium">{mac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        {user.isDemo ? (
          <Tooltip content="You're exploring sample data from a simulated bank. Nothing here is real money.">
            <Badge variant="warning" className="ml-1 shrink-0">
              Demo
            </Badge>
          </Tooltip>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={openSearch}>
            <Search />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" aria-label="Add new" className="max-sm:size-9 max-sm:px-0">
                <Plus />
                <span className="hidden sm:inline">New</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuItem onSelect={() => openQuickAdd()}>
                <Plus /> Transaction
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push("/goals?new=1")}>
                <Target /> Goal
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push("/budget?new=1")}>
                <CalendarDays /> Budget
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push("/accounts/new")}>
                <Landmark /> Account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push("/transactions/import")}>
                <FileUp /> Import CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <NotificationsMenu initialUnread={unread} />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
