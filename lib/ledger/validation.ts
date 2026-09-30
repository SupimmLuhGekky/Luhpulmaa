import type { JournalEntryInput } from "./types";

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

/**
 * Validates a journal entry before posting:
 *  - at least one debit and one credit line
 *  - every amount is a positive safe integer (cents)
 *  - one currency per entry (cross-currency postings need an explicit FX account pair)
 *  - total debits equal total credits
 */
export function validateJournalEntry(entry: JournalEntryInput): void {
  if (!entry.idempotencyKey.trim()) throw new LedgerValidationError("An idempotency key is required.");
  if (!entry.description.trim()) throw new LedgerValidationError("A description is required.");
  if (entry.lines.length < 2) throw new LedgerValidationError("A journal entry needs at least two lines.");
  const currencies = new Set(entry.lines.map((l) => l.currency));
  if (currencies.size !== 1) throw new LedgerValidationError("All lines of a journal entry must use one currency.");
  let debits = 0n;
  let credits = 0n;
  for (const line of entry.lines) {
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents <= 0) {
      throw new LedgerValidationError("Ledger amounts must be positive whole cents.");
    }
    if (!line.accountCode.trim()) throw new LedgerValidationError("Every line needs an account code.");
    if (line.direction === "DEBIT") debits += BigInt(line.amountCents);
    else credits += BigInt(line.amountCents);
  }
  if (debits === 0n || credits === 0n) throw new LedgerValidationError("A journal entry needs both debit and credit lines.");
  if (debits !== credits) throw new LedgerValidationError(`Unbalanced entry: debits ${debits} ≠ credits ${credits}.`);
}
