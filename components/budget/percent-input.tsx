"use client";

import * as React from "react";
import { inputClass } from "@/components/ui/input";
import { formatBpsInput, parsePercentToBps } from "@/lib/budget/percent";
import { cn } from "@/lib/utils";

export interface PercentInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "defaultValue"> {
  /** Basis points (1250 = 12.5%), or null when empty. */
  value: number | null | undefined;
  onChange: (bps: number | null) => void;
  locale?: string;
  /** Largest accepted value in basis points (default 100%). */
  maxBps?: number;
}

/** Percentage field with up to two decimals that stores basis points (no floating point). */
export const PercentInput = React.forwardRef<HTMLInputElement, PercentInputProps>(({ value, onChange, locale = "en-CA", maxBps = 10000, className, onBlur, ...props }, ref) => {
  const [text, setText] = React.useState(() => formatBpsInput(value, locale));
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setText(formatBpsInput(value, locale));
  }, [value, locale]);

  return (
    <div className={cn("relative w-full min-w-0", className)}>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn(inputClass, "tabular pr-8")}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d.,]/g, "");
          setText(next);
          onChange(next ? parsePercentToBps(next, maxBps) : null);
        }}
        onBlur={(e) => {
          focused.current = false;
          const bps = text ? parsePercentToBps(text, maxBps) : null;
          if (bps !== null) setText(formatBpsInput(bps, locale));
          onBlur?.(e);
        }}
        {...props}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
        %
      </span>
    </div>
  );
});
PercentInput.displayName = "PercentInput";
