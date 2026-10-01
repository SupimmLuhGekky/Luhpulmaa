"use client";

import { CalendarClock, CreditCard, Gauge, Landmark, PiggyBank, PieChart, Wallet, type LucideIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { APP_GOALS, type AppGoalKey } from "@/lib/settings/options";
import { cn } from "@/lib/utils";

const ICONS: Record<AppGoalKey, LucideIcon> = {
  track_spending: PieChart,
  budget: Wallet,
  save: PiggyBank,
  debt: CreditCard,
  bills: CalendarClock,
  cash_flow: Gauge,
  net_worth: Landmark,
};

/** "What would you like help with?" as checkable cards (several can be picked). */
export function AppGoalPicker({ value, onChange, disabled }: { value: AppGoalKey[]; onChange: (next: AppGoalKey[]) => void; disabled?: boolean }) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {APP_GOALS.map((g) => {
        const Icon = ICONS[g.key];
        const checked = value.includes(g.key);
        const id = `app-goal-${g.key}`;
        return (
          <li key={g.key}>
            <label
              htmlFor={id}
              className={cn(
                "flex h-full cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors",
                checked ? "border-primary bg-primary-soft/60" : "border-border bg-card hover:bg-subtle",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} aria-hidden>
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{g.label}</span>
                <span className="block text-[13px] leading-snug text-muted-foreground">{g.description}</span>
              </span>
              <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                className="mt-0.5"
                onCheckedChange={(v) => onChange(v === true ? [...value, g.key] : value.filter((k) => k !== g.key))}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
