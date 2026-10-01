/**
 * Duplicate detection for imported transactions. Pure functions.
 *
 * A candidate is a duplicate of an existing transaction when, in order:
 *  1. Same account and the same provider transaction id (authoritative), or
 *  2. It is the posted version of a pending transaction we already hold, or
 *  3. Same account + identical fingerprint (date, amount, normalised description), or
 *  4. Fuzzy: same account, same amount, dates within the tolerance window and similar
 *     merchant/description — but only when at least one side lacks a provider id
 *     (two distinct provider ids are trusted to be two real transactions).
 */
import { createHash } from "node:crypto";
import { daysBetween, type LocalDate } from "@/lib/dates";
import { merchantSimilarity, normalizeMerchant } from "./normalize";

export interface DedupeCandidate {
  accountId: string;
  providerTransactionId?: string | null;
  pendingTransactionId?: string | null;
  date: LocalDate;
  amountCents: number;
  description: string;
  merchantName?: string | null;
}

export interface DedupeExisting extends DedupeCandidate {
  id: string;
  isPending: boolean;
  fingerprint: string;
}

export type DuplicateMatch =
  | { kind: "provider_id"; existingId: string }
  | { kind: "pending_to_posted"; existingId: string }
  | { kind: "fingerprint"; existingId: string }
  | { kind: "fuzzy"; existingId: string; score: number };

export const FUZZY_DATE_WINDOW_DAYS = 3;
export const FUZZY_SIMILARITY_THRESHOLD = 0.8;

export function transactionFingerprint(t: Pick<DedupeCandidate, "accountId" | "date" | "amountCents" | "description" | "merchantName">): string {
  const key = [t.accountId, t.date, String(t.amountCents), normalizeMerchant(t.merchantName || t.description)].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

/**
 * @param claimed ids of existing rows already matched by earlier candidates in the same
 *   batch. Each existing row can absorb at most one candidate, so a file containing two
 *   identical $2.50 coffees against a database holding one imports exactly one more.
 */
export function findDuplicate(candidate: DedupeCandidate, existing: DedupeExisting[], claimed: Set<string> = new Set()): DuplicateMatch | null {
  const sameAccount = existing.filter((e) => e.accountId === candidate.accountId && !claimed.has(e.id));

  if (candidate.providerTransactionId) {
    const byId = sameAccount.find((e) => e.providerTransactionId === candidate.providerTransactionId);
    if (byId) return { kind: "provider_id", existingId: byId.id };
  }
  if (candidate.pendingTransactionId) {
    const pending = sameAccount.find((e) => e.providerTransactionId === candidate.pendingTransactionId);
    if (pending) return { kind: "pending_to_posted", existingId: pending.id };
  }
  const fp = transactionFingerprint(candidate);
  const byFp = sameAccount.find((e) => e.fingerprint === fp && !(candidate.providerTransactionId && e.providerTransactionId && e.providerTransactionId !== candidate.providerTransactionId));
  if (byFp) return { kind: "fingerprint", existingId: byFp.id };

  let best: { id: string; score: number; days: number } | null = null;
  for (const e of sameAccount) {
    if (e.amountCents !== candidate.amountCents) continue;
    const days = Math.abs(daysBetween(e.date, candidate.date));
    if (days > FUZZY_DATE_WINDOW_DAYS) continue;
    const bothHaveIds = Boolean(candidate.providerTransactionId && e.providerTransactionId);
    // A pending transaction may be re-issued with a new id when it posts.
    if (bothHaveIds && !e.isPending) continue;
    // Sources name the same purchase differently (a CSV's "UBER CANADA/UBEREATS TORONTO" is
    // "Uber Eats" from a provider), so the bank's own descriptions are compared too.
    const score = Math.max(
      merchantSimilarity(candidate.merchantName || candidate.description, e.merchantName || e.description),
      descriptionSimilarity(candidate.description, e.description),
    );
    if (score < FUZZY_SIMILARITY_THRESHOLD) continue;
    // Ties go to the closest date: two identical coffees on consecutive days match their own day.
    if (!best || score > best.score || (score === best.score && days < best.days)) best = { id: e.id, score, days };
  }
  return best ? { kind: "fuzzy", existingId: best.id, score: best.score } : null;
}

/** Like merchantSimilarity, but descriptions that are only noise words ("POS PURCHASE") never match. */
function descriptionSimilarity(a: string, b: string): number {
  return normalizeMerchant(a) && normalizeMerchant(b) ? merchantSimilarity(a, b) : 0;
}

/** Removes duplicates inside one batch (e.g. an overlapping CSV export). Keeps the first occurrence. */
export function dedupeBatch<T extends DedupeCandidate>(rows: T[]): { unique: T[]; duplicates: T[] } {
  const seenIds = new Set<string>();
  const seenFp = new Map<string, number>();
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const row of rows) {
    if (row.providerTransactionId) {
      const key = `${row.accountId}|${row.providerTransactionId}`;
      if (seenIds.has(key)) {
        duplicates.push(row);
        continue;
      }
      seenIds.add(key);
      unique.push(row);
      continue;
    }
    // Without ids, identical rows in one file can be legitimate (two identical coffees),
    // so we count occurrences and only treat them as duplicates across batches.
    const fp = transactionFingerprint(row);
    seenFp.set(fp, (seenFp.get(fp) ?? 0) + 1);
    unique.push(row);
  }
  return { unique, duplicates };
}
