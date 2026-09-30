import { formatCurrency } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

export interface MoneyProps {
  cents: number;
  currency?: string;
  locale?: string;
  /** Show + for positive values. */
  signed?: boolean;
  /** Colour inflows green (and optionally outflows). */
  tone?: "auto" | "inflow" | "none";
  wholeDollars?: boolean;
  compact?: boolean;
  className?: string;
}

/** Tabular, locale-aware amount. All amounts are integer cents. */
export function Money({ cents, currency = "CAD", locale = "en-CA", signed, tone = "none", wholeDollars, compact, className }: MoneyProps) {
  const text = formatCurrency(cents, { currency, locale, signed, wholeDollars, compact });
  const toneClass = tone === "inflow" ? (cents > 0 ? "text-positive" : undefined) : tone === "auto" ? (cents > 0 ? "text-positive" : cents < 0 ? "text-foreground" : "text-muted-foreground") : undefined;
  return <span className={cn("tabular whitespace-nowrap", toneClass, className)}>{text}</span>;
}
