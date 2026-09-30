"use client";

import * as React from "react";
import { centsToDecimalString, parseMoney } from "@/lib/finance/money";
import { cn } from "@/lib/utils";
import { inputClass } from "./input";

export interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "defaultValue"> {
  /** Integer cents, or null when empty. */
  value: number | null | undefined;
  onChange: (cents: number | null) => void;
  currency?: string;
  locale?: string;
  allowNegative?: boolean;
}

function display(cents: number | null | undefined, locale: string) {
  if (cents === null || cents === undefined) return "";
  const s = centsToDecimalString(Math.abs(cents));
  const [whole, frac] = s.split(".");
  const grouped = Number(whole).toLocaleString(locale, { maximumFractionDigits: 0 });
  const sep = locale.startsWith("fr") ? "," : ".";
  return `${cents < 0 ? "-" : ""}${grouped}${sep}${frac}`;
}

/**
 * Money input that never uses floating point: the text is parsed with parseMoney()
 * into integer cents on every keystroke and re-formatted on blur.
 */
export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, currency = "CAD", locale = "en-CA", allowNegative = false, className, onBlur, ...props }, ref) => {
    const [text, setText] = React.useState(() => display(value, locale));
    const focused = React.useRef(false);

    React.useEffect(() => {
      if (!focused.current) setText(display(value, locale));
    }, [value, locale]);

    const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
    const french = locale.startsWith("fr");
    return (
      <div className={cn("relative w-full min-w-0", className)}>
        {!french ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>{symbol}</span> : null}
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={cn(inputClass, "tabular", french ? "pr-7" : "pl-7")}
          value={text}
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            const next = e.target.value.replace(allowNegative ? /[^\d.,\s()\-−]/g : /[^\d.,\s]/g, "");
            setText(next);
            const cents = parseMoney(next, locale);
            onChange(cents === null ? null : allowNegative ? cents : Math.abs(cents));
          }}
          onBlur={(e) => {
            focused.current = false;
            const cents = parseMoney(text, locale);
            setText(display(cents === null ? null : allowNegative ? cents : Math.abs(cents), locale));
            onBlur?.(e);
          }}
          {...props}
        />
        {french ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>{symbol}</span> : null}
      </div>
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";
