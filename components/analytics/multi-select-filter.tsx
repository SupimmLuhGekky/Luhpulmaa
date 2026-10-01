"use client";

import * as React from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CategoryIcon } from "@/components/shared/category-icon";
import { cn } from "@/lib/utils";

export interface FilterOption {
  id: string;
  name: string;
  /** Secondary text, e.g. the institution. */
  detail?: string | null;
  icon?: string | null;
  color?: string | null;
}

export interface FilterGroup {
  label?: string;
  options: FilterOption[];
}

/**
 * Multi-select filter in a popover: choices are drafted and only applied with
 * "Apply", so picking several items costs one page load. Nothing selected means
 * everything is included.
 */
export function MultiSelectFilter({ label, allLabel, noun, icon: Icon, groups, selected, onApply, className }: {
  /** "Accounts" */
  label: string;
  /** "All accounts" */
  allLabel: string;
  /** Plural noun for counts: "accounts" */
  noun: string;
  icon: LucideIcon;
  groups: FilterGroup[];
  selected: string[];
  onApply: (ids: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Set<string>>(() => new Set(selected));
  const all = React.useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const names = selected.map((id) => all.find((o) => o.id === id)?.name).filter((n): n is string => Boolean(n));
  const summary = names.length === 0 ? allLabel : names.length === 1 ? names[0] : `${names.length} ${noun}`;
  const listId = React.useId();

  const toggle = (id: string, on: boolean) =>
    setDraft((d) => {
      const next = new Set(d);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const apply = () => {
    // Choosing every option is the same as no filter: keep the URL short.
    const ids = all.filter((o) => draft.has(o.id)).map((o) => o.id);
    onApply(ids.length === all.length ? [] : ids);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(new Set(selected));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("min-w-0 justify-start gap-2 px-3 font-normal", names.length > 0 && "border-primary/60 bg-primary-soft/40", className)}>
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">{label}: </span>
          <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-2rem))] flex-col p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground" id={`${listId}-label`}>
            {label}
          </p>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setDraft(draft.size ? new Set() : new Set(all.map((o) => o.id)))}>
            {draft.size ? "Clear" : "Select all"}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="group" aria-labelledby={`${listId}-label`}>
          {all.length === 0 ? <p className="px-2 py-3 text-[13px] text-muted-foreground">Nothing to choose from yet.</p> : null}
          {groups.map((g, gi) =>
            g.options.length ? (
              <div key={g.label ?? gi} role={g.label ? "group" : undefined} aria-label={g.label}>
                {g.label ? <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{g.label}</p> : null}
                {g.options.map((o) => {
                  const id = `${listId}-${o.id}`;
                  return (
                    <label key={o.id} htmlFor={id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-subtle">
                      <Checkbox id={id} checked={draft.has(o.id)} onCheckedChange={(c) => toggle(o.id, c === true)} />
                      {o.icon !== undefined ? <CategoryIcon icon={o.icon} color={o.color} size="sm" /> : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{o.name}</span>
                        {o.detail ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {o.detail}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null,
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
          <p className="min-w-0 text-xs text-muted-foreground" aria-live="polite">
            {draft.size === 0 || draft.size === all.length ? `All ${noun} included` : `${draft.size} of ${all.length} selected`}
          </p>
          <Button size="sm" onClick={apply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
