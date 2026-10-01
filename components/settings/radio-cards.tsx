"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface RadioCardOption<T extends string> {
  value: T;
  label: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

/**
 * A single choice shown as selectable cards. Behaves like a radio group: one tab stop,
 * arrow keys move the selection.
 */
export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  columns = 1,
  disabled,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly RadioCardOption<T>[];
  columns?: 1 | 2 | 3;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);
  const move = (delta: number) => {
    if (!enabled.length) return;
    const i = Math.max(
      0,
      enabled.findIndex((o) => o.value === value),
    );
    const next = enabled[(i + delta + enabled.length) % enabled.length];
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-disabled={disabled || undefined}
      className={cn("grid gap-2.5", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3", className)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        const isDisabled = disabled || o.disabled;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={isDisabled}
            tabIndex={checked || (!enabled.some((x) => x.value === value) && o === enabled[0]) ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
              checked ? "border-primary bg-primary-soft/60 ring-1 ring-primary" : "border-border bg-card hover:border-foreground/25 hover:bg-accent/50",
            )}
          >
            <span
              aria-hidden
              className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", checked ? "border-primary bg-primary" : "border-input bg-background")}
            >
              {checked ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
            </span>
            {o.icon ? <span className={cn("mt-px shrink-0", checked ? "text-primary" : "text-muted-foreground")}>{o.icon}</span> : null}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{o.label}</span>
              {o.description ? <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{o.description}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
