"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Updates the page's query string (the source of truth for filters, ranges and
 * calendar position) inside a transition, so the current render stays on screen
 * (dimmed via `pending`) while the server renders the new data.
 */
export function useParamNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const hrefWith = React.useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const navigate = React.useCallback(
    (patch: Record<string, string | null | undefined>, opts: { replace?: boolean } = {}) => {
      const href = hrefWith(patch);
      startTransition(() => {
        if (opts.replace) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [hrefWith, router],
  );

  return { navigate, hrefWith, pending, searchParams };
}
