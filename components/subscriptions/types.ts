import type { listSubscriptions } from "@/lib/subscriptions/service";
import type { listRecurring } from "@/lib/recurring/service";

export type SubscriptionRow = Awaited<ReturnType<typeof listSubscriptions>>["rows"][number];
export type SubscriptionTotals = Awaited<ReturnType<typeof listSubscriptions>>["totals"];

/** A detected recurring charge (money out) that isn't a subscription yet. */
export type RecurringCandidate = Awaited<ReturnType<typeof listRecurring>>[number] & { isBill: boolean };

export interface SubscriptionFormOptions {
  categories: { id: string; name: string; icon: string; color: string }[];
  accounts: { id: string; name: string; mask: string | null }[];
}

export const STATUS_LABELS = { ACTIVE: "Active", PAUSED: "Paused", CANCELLED: "Cancelled" } as const;
export type SubscriptionStatus = keyof typeof STATUS_LABELS;
