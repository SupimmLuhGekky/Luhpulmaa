import type { AccountType } from "@prisma/client";
import { stripAccents } from "@/lib/transactions/normalize";

/**
 * Suggests which existing manual account each Lunch Flow account continues, so someone
 * who imported Neo's CSV files into "Neo card" doesn't end up with a second copy of that
 * card. Pure and client-safe: the connect dialog preselects the result and the person
 * can change it.
 */

export interface MatchableLunchFlowAccount {
  providerAccountId: string;
  name: string;
  institution: string;
  currency: string;
  suggestedType: AccountType;
  existing: unknown;
  skipped: boolean;
  supported?: boolean;
}

export interface MatchableManualAccount {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  institution: string | null;
}

/** Words that say what kind of account it is rather than which one. */
const GENERIC = new Set([
  "account", "accounts", "compte", "comptes", "card", "carte", "credit", "debit", "visa", "mastercard", "amex", "world", "elite",
  "chequing", "checking", "cheque", "cheques", "savings", "saving", "epargne", "everyday", "bank", "banque", "financial",
  "financiere", "the", "my", "mon", "ma", "mes", "de", "du", "des", "la", "le", "les", "and", "et", "inc", "ltd", "plus", "secured",
]);

function distinctiveWords(...texts: (string | null | undefined)[]): Set<string> {
  const words = new Set<string>();
  for (const text of texts) {
    for (const w of stripAccents(text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length > 1 && !GENERIC.has(w)) words.add(w);
    }
  }
  return words;
}

/**
 * Lunch Flow account id → manual account id, for accounts with exactly one candidate of
 * the same currency and type sharing a distinctive word ("Neo Mastercard" and "Neo card"),
 * where that candidate isn't also claimed by another Lunch Flow account.
 */
export function suggestLinks(accounts: MatchableLunchFlowAccount[], manual: MatchableManualAccount[]): Record<string, string> {
  const candidates = new Map<string, string[]>();
  for (const a of accounts) {
    if (a.existing || a.skipped || a.supported === false) continue;
    const words = distinctiveWords(a.name, a.institution);
    const matches = manual.filter((m) => m.currency === a.currency && m.type === a.suggestedType && [...distinctiveWords(m.name, m.institution)].some((w) => words.has(w)));
    candidates.set(a.providerAccountId, matches.map((m) => m.id));
  }
  const claims = new Map<string, number>();
  for (const ids of candidates.values()) for (const id of ids) claims.set(id, (claims.get(id) ?? 0) + 1);
  const out: Record<string, string> = {};
  for (const [providerAccountId, ids] of candidates) {
    const only = ids.length === 1 ? ids[0]! : null;
    if (only && claims.get(only) === 1) out[providerAccountId] = only;
  }
  return out;
}
