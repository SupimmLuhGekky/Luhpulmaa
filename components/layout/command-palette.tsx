"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { ArrowLeftRight, CalendarDays, FileUp, Landmark, Loader2, Plus, Repeat, Search, Tag, Target, type LucideIcon } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { DialogOverlay } from "@/components/ui/dialog";
import { useFormat } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS, SETTINGS_ITEM } from "./nav-items";
import type { ShellFlags } from "./sidebar";

interface SearchResult {
  type: "transaction" | "account" | "category" | "goal" | "bill" | "subscription" | "merchant";
  id: string;
  title: string;
  subtitle?: string;
  amountCents?: number;
  href: string;
}

const GROUPS: { type: SearchResult["type"]; label: string; icon: LucideIcon }[] = [
  { type: "transaction", label: "Transactions", icon: ArrowLeftRight },
  { type: "account", label: "Accounts", icon: Landmark },
  { type: "goal", label: "Goals", icon: Target },
  { type: "category", label: "Categories", icon: Tag },
  { type: "bill", label: "Bills", icon: CalendarDays },
  { type: "subscription", label: "Subscriptions", icon: Repeat },
];

const itemClass =
  "flex cursor-default select-none items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
const groupClass = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground";

/** ⌘K / Ctrl+K: jump to any page, run a quick action, or search your own records. */
export function CommandPalette({ open, onOpenChange, flags, onQuickAdd }: { open: boolean; onOpenChange: (open: boolean) => void; flags: ShellFlags; onQuickAdd: () => void }) {
  const router = useRouter();
  const fmt = useFormat();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Record<string, SearchResult[]> | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(null);
    }
  }, [open]);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { data?: Record<string, SearchResult[]> } | null) => {
          setResults(body?.data ?? {});
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (!(e instanceof DOMException && e.name === "AbortError")) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const q = query.trim().toLowerCase();
  const pages = [...NAV_SECTIONS.flatMap((s) => s.items).filter((i) => !i.flag || flags[i.flag]), SETTINGS_ITEM, { href: "/notifications", label: "Notifications", icon: Search }].filter(
    (p) => !q || p.label.toLowerCase().includes(q),
  );
  const actions = [
    { id: "add-transaction", label: "Add a transaction", icon: Plus, run: () => (onOpenChange(false), onQuickAdd()) },
    { id: "import", label: "Import a CSV file (e.g. from Neo Financial)", icon: FileUp, run: () => go("/transactions/import") },
    { id: "add-account", label: "Add an account", icon: Landmark, run: () => go("/accounts/new") },
    { id: "new-goal", label: "Create a savings goal", icon: Target, run: () => go("/goals?new=1") },
    { id: "new-bill", label: "Add a bill", icon: CalendarDays, run: () => go("/bills?new=1") },
  ].filter((a) => !q || a.label.toLowerCase().includes(q));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed inset-x-3 top-[12dvh] z-50 mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-pop data-[state=open]:animate-scale-in focus:outline-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <Command shouldFilter={false} loop label="Search and commands">
            <div className="flex items-center gap-2 border-b border-border px-3">
              {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : <Search className="size-4 text-muted-foreground" aria-hidden />}
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search transactions, accounts, goals… or jump to a page"
                className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
              />
              <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">Esc</kbd>
            </div>
            <Command.List className="max-h-[60dvh] overflow-y-auto overscroll-contain p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">{loading ? "Searching…" : "No matches."}</Command.Empty>
              {results
                ? GROUPS.map((g) =>
                    results[g.type]?.length ? (
                      <Command.Group key={g.type} heading={g.label} className={groupClass}>
                        {results[g.type].map((r) => (
                          <Command.Item key={`${r.type}:${r.id}`} value={`${r.type}:${r.id}`} onSelect={() => go(r.href)} className={itemClass}>
                            <g.icon aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{r.title}</span>
                              {r.subtitle ? <span className="block truncate text-xs capitalize text-muted-foreground">{r.subtitle}</span> : null}
                            </span>
                            {r.amountCents !== undefined ? <span className={cn("tabular text-xs", r.amountCents > 0 && r.type === "transaction" ? "text-positive" : "text-muted-foreground")}>{fmt.money(r.amountCents)}</span> : null}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    ) : null,
                  )
                : null}
              {actions.length ? (
                <Command.Group heading="Quick actions" className={groupClass}>
                  {actions.map((a) => (
                    <Command.Item key={a.id} value={a.id} onSelect={a.run} className={itemClass}>
                      <a.icon aria-hidden />
                      {a.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {pages.length ? (
                <Command.Group heading="Go to" className={groupClass}>
                  {pages.map((p) => (
                    <Command.Item key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)} className={itemClass}>
                      <p.icon aria-hidden />
                      {p.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
