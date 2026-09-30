"use client";

import * as React from "react";
import { formatCurrency, type FormatCurrencyOptions } from "@/lib/finance/money";
import { formatDate, formatRelativeDay, type DateStyle, type LocalDate } from "@/lib/dates";

export interface FormatSettings {
  currency: string;
  locale: string;
  timeZone: string;
  today: LocalDate;
}

const FormatContext = React.createContext<FormatSettings>({ currency: "CAD", locale: "en-CA", timeZone: "America/Toronto", today: new Date().toISOString().slice(0, 10) });

/** Supplies the signed-in user's currency, locale, time zone and "today" to client components. */
export function FormatProvider({ value, children }: { value: FormatSettings; children: React.ReactNode }) {
  return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>;
}

export function useFormat() {
  const s = React.useContext(FormatContext);
  return React.useMemo(
    () => ({
      ...s,
      money: (cents: number, opts: FormatCurrencyOptions = {}) => formatCurrency(cents, { currency: s.currency, locale: s.locale, ...opts }),
      date: (d: LocalDate | null | undefined, style: DateStyle = "medium") => formatDate(d, style, s.locale),
      relative: (d: LocalDate) => formatRelativeDay(d, s.today, s.locale),
    }),
    [s],
  );
}
