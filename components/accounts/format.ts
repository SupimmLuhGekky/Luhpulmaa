"use client";

import * as React from "react";
import { useFormat } from "@/components/providers/format-provider";
import { relativeTimeAgo } from "@/lib/accounts/summary";
import { dateInZone, formatDateTime } from "@/lib/dates";

/**
 * Formatting for account screens. `now` comes from the server render so relative
 * times ("3 hours ago") are identical on the server and during hydration.
 */
export function useAccountFormat(now: string) {
  const f = useFormat();
  return React.useMemo(
    () => ({
      ...f,
      /** Money in the account's own currency. */
      amount: (cents: number, currency: string, opts: { signed?: boolean; wholeDollars?: boolean } = {}) => f.money(cents, { currency, ...opts }),
      /** "2 hours ago" or "on Aug 3, 2026"; null when never synced. */
      ago: (iso: string | null) => (iso ? (relativeTimeAgo(iso, now) ?? `on ${f.date(dateInZone(new Date(iso), f.timeZone), "medium")}`) : null),
      /** Full local date and time, for titles and tooltips. */
      dateTime: (iso: string) => formatDateTime(iso, f.timeZone, f.locale),
    }),
    [f, now],
  );
}

export type AccountFormat = ReturnType<typeof useAccountFormat>;

/** "Plaid's", "Flinks'": possessive of a provider or institution name. */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}
