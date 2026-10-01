"use client";

import * as React from "react";
import { Bell, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_THRESHOLD, MAX_THRESHOLDS, MIN_THRESHOLD, normalizeThresholds, THRESHOLD_PRESETS } from "@/lib/budget/thresholds";
import { cn } from "@/lib/utils";

function listPercents(values: number[]) {
  const parts = values.map((t) => `${t}%`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

/**
 * Alert thresholds for a budget line: quick picks (50/75/80/90/100%) plus any custom
 * whole percent from 1 to 200. Toggle buttons expose their state with aria-pressed.
 */
export function ThresholdPicker({ value, onChange, id, fallback = [] }: { value: number[]; onChange: (next: number[]) => void; id?: string; /** Alerts that apply when the line has none of its own. */ fallback?: number[] }) {
  const [custom, setCustom] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const customs = value.filter((t) => !(THRESHOLD_PRESETS as readonly number[]).includes(t));
  const full = value.length >= MAX_THRESHOLDS;

  const toggle = (t: number) => {
    setError(null);
    if (value.includes(t)) onChange(value.filter((x) => x !== t));
    else if (!full) onChange(normalizeThresholds([...value, t]));
    else setError(`Up to ${MAX_THRESHOLDS} alerts per line.`);
  };

  const addCustom = () => {
    const n = Number(custom.trim());
    if (!Number.isInteger(n) || n < MIN_THRESHOLD || n > MAX_THRESHOLD) {
      setError(`Enter a whole percent from ${MIN_THRESHOLD} to ${MAX_THRESHOLD}.`);
      return;
    }
    if (value.includes(n)) {
      setCustom("");
      return;
    }
    if (full) {
      setError(`Up to ${MAX_THRESHOLDS} alerts per line.`);
      return;
    }
    onChange(normalizeThresholds([...value, n]));
    setCustom("");
    setError(null);
  };

  return (
    <div className="space-y-2.5" id={id}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Alert when spending reaches">
        {THRESHOLD_PRESETS.map((t) => {
          const on = value.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t)}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] font-medium tabular transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                on ? "border-primary/40 bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {on ? <Bell className="size-3.5" aria-hidden /> : null}
              {t}%
            </button>
          );
        })}
        {customs.map((t) => (
          <span key={t} className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary-soft pl-3 pr-1 text-[13px] font-medium tabular text-primary">
            <Bell className="size-3.5" aria-hidden />
            {t}%
            <button type="button" onClick={() => toggle(t)} className="rounded-full p-1 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Remove the ${t}% alert`}>
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative w-28">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            inputMode="numeric"
            placeholder="Custom"
            aria-label="Custom alert percentage"
            className="pr-7"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
            %
          </span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addCustom} disabled={!custom}>
          <Plus /> Add
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {value.length
            ? `You'll be notified when spending reaches ${listPercents(value)} of this line.`
            : fallback.length
              ? `Your default alerts apply (${listPercents(fallback)}). Change them in Settings.`
              : "No alerts for this line."}
        </p>
      )}
    </div>
  );
}
