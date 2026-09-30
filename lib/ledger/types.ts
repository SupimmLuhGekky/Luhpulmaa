/**
 * Double-entry ledger types. The ledger is deliberately separate from the budgeting
 * data model: budgeting rows (transactions, goals, allocations) describe money that
 * lives at other institutions, while a ledger records money a licensed operator
 * actually holds. Nothing in the budgeting app posts to it today; it exists so a
 * future banking core can be added without reshaping the product.
 */
export type LedgerAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type LedgerDirection = "DEBIT" | "CREDIT";

export interface LedgerLine {
  accountCode: string;
  direction: LedgerDirection;
  /** Positive integer cents. The direction carries the sign. */
  amountCents: number;
  currency: string;
}

export interface JournalEntryInput {
  /** Unique key of the originating event; posting the same key twice is a no-op. */
  idempotencyKey: string;
  description: string;
  effectiveAt: Date;
  userId?: string | null;
  lines: LedgerLine[];
}

export interface PostedJournalEntry {
  id: string;
  idempotencyKey: string;
  created: boolean;
}

export interface LedgerService {
  postJournalEntry(entry: JournalEntryInput): Promise<PostedJournalEntry>;
  /** Balance on the account's normal side (debit-normal for assets/expenses). */
  getBalance(accountCode: string): Promise<{ balanceCents: number; currency: string }>;
  /** Sum of all debits minus all credits across the ledger; always zero when healthy. */
  trialBalance(currency: string): Promise<{ debitsCents: number; creditsCents: number; balanced: boolean }>;
}

/** Accounts whose balance grows with debits. */
export const DEBIT_NORMAL: ReadonlySet<LedgerAccountType> = new Set(["ASSET", "EXPENSE"]);
