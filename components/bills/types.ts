import type { BillOccurrence, BillsBeforePayday, listBills } from "@/lib/bills/service";

export type Occurrence = BillOccurrence;
export type BillRow = Awaited<ReturnType<typeof listBills>>[number];
export type BeforePayday = BillsBeforePayday;

export interface BillFormOptions {
  categories: { id: string; name: string; icon: string; color: string }[];
  accounts: { id: string; name: string; mask: string | null }[];
  /** Reminder for a new bill, from the user's settings (days before the due date). */
  defaultReminderDays: number;
}

/** Stable key of one occurrence (a bill on one due date). */
export function occurrenceKey(o: { billId: string; dueDate: string }) {
  return `${o.billId}:${o.dueDate}`;
}
