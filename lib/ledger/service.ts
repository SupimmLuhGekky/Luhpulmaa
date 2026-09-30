import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { toCents } from "@/lib/finance/money";
import { DEBIT_NORMAL, type JournalEntryInput, type LedgerService, type PostedJournalEntry } from "./types";
import { LedgerValidationError, validateJournalEntry } from "./validation";

/**
 * Prisma-backed double-entry ledger. Entries are append-only: corrections are new
 * reversing entries, never updates. Posting is atomic and idempotent per key.
 *
 * Not wired into the budgeting app — see lib/ledger/types.ts.
 */
export class PrismaLedgerService implements LedgerService {
  async postJournalEntry(entry: JournalEntryInput): Promise<PostedJournalEntry> {
    validateJournalEntry(entry);
    const existing = await prisma.ledgerJournalEntry.findUnique({ where: { idempotencyKey: entry.idempotencyKey }, select: { id: true } });
    if (existing) return { id: existing.id, idempotencyKey: entry.idempotencyKey, created: false };

    const codes = [...new Set(entry.lines.map((l) => l.accountCode))];
    try {
      return await prisma.$transaction(
        async (tx) => {
          const accounts = await tx.ledgerAccount.findMany({ where: { code: { in: codes } } });
          const byCode = new Map(accounts.map((a) => [a.code, a]));
          for (const line of entry.lines) {
            const account = byCode.get(line.accountCode);
            if (!account) throw new LedgerValidationError(`Unknown ledger account ${line.accountCode}.`);
            if (account.currency !== line.currency) throw new LedgerValidationError(`Account ${line.accountCode} is not in ${line.currency}.`);
          }
          const journal = await tx.ledgerJournalEntry.create({
            data: {
              idempotencyKey: entry.idempotencyKey,
              description: entry.description,
              effectiveAt: entry.effectiveAt,
              userId: entry.userId ?? null,
              entries: {
                create: entry.lines.map((l) => ({
                  ledgerAccountId: byCode.get(l.accountCode)!.id,
                  direction: l.direction,
                  amountCents: BigInt(l.amountCents),
                  currency: l.currency,
                })),
              },
            },
            select: { id: true },
          });
          return { id: journal.id, idempotencyKey: entry.idempotencyKey, created: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // A concurrent post with the same key won the race: return that entry.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await prisma.ledgerJournalEntry.findUniqueOrThrow({ where: { idempotencyKey: entry.idempotencyKey }, select: { id: true } });
        return { id: winner.id, idempotencyKey: entry.idempotencyKey, created: false };
      }
      throw error;
    }
  }

  async getBalance(accountCode: string) {
    const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: accountCode } });
    const sums = await prisma.ledgerEntry.groupBy({ by: ["direction"], where: { ledgerAccountId: account.id }, _sum: { amountCents: true } });
    const debit = toCents(sums.find((s) => s.direction === "DEBIT")?._sum.amountCents ?? 0n);
    const credit = toCents(sums.find((s) => s.direction === "CREDIT")?._sum.amountCents ?? 0n);
    const balanceCents = DEBIT_NORMAL.has(account.type) ? debit - credit : credit - debit;
    return { balanceCents, currency: account.currency };
  }

  async trialBalance(currency: string) {
    const sums = await prisma.ledgerEntry.groupBy({ by: ["direction"], where: { currency }, _sum: { amountCents: true } });
    const debitsCents = toCents(sums.find((s) => s.direction === "DEBIT")?._sum.amountCents ?? 0n);
    const creditsCents = toCents(sums.find((s) => s.direction === "CREDIT")?._sum.amountCents ?? 0n);
    return { debitsCents, creditsCents, balanced: debitsCents === creditsCents };
  }
}
