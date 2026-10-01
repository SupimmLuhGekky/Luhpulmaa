import { describe, expect, it } from "vitest";
import { dedupeBatch, findDuplicate, transactionFingerprint, type DedupeCandidate, type DedupeExisting } from "@/lib/transactions/dedupe";

const ACCOUNT = "acct-chequing";
const OTHER = "acct-credit";

function existing(id: string, t: Partial<DedupeExisting> & Pick<DedupeCandidate, "date" | "amountCents" | "description">): DedupeExisting {
  const base = { accountId: ACCOUNT, providerTransactionId: null, isPending: false, merchantName: null, ...t };
  return { ...base, id, fingerprint: transactionFingerprint(base) };
}

describe("transactionFingerprint", () => {
  it("is a stable 40-character hex digest", () => {
    const fp = transactionFingerprint({ accountId: ACCOUNT, date: "2026-09-30", amountCents: -250, description: "TIM HORTONS #4412" });
    expect(fp).toMatch(/^[0-9a-f]{40}$/);
    expect(transactionFingerprint({ accountId: ACCOUNT, date: "2026-09-30", amountCents: -250, description: "TIM HORTONS #4412" })).toBe(fp);
  });

  it("ignores store numbers and processor prefixes but not the account, date or amount", () => {
    const base = { accountId: ACCOUNT, date: "2026-09-30", amountCents: -250, description: "TIM HORTONS #4412" };
    const fp = transactionFingerprint(base);
    expect(transactionFingerprint({ ...base, description: "SQ *TIM HORTONS #9981 MONTREAL QC" })).toBe(fp);
    expect(transactionFingerprint({ ...base, accountId: OTHER })).not.toBe(fp);
    expect(transactionFingerprint({ ...base, date: "2026-10-01" })).not.toBe(fp);
    expect(transactionFingerprint({ ...base, amountCents: -251 })).not.toBe(fp);
    expect(transactionFingerprint({ ...base, amountCents: 250 })).not.toBe(fp);
  });

  it("prefers the merchant name over the raw description", () => {
    const a = transactionFingerprint({ accountId: ACCOUNT, date: "2026-09-30", amountCents: -999, description: "POS 12345 XYZ", merchantName: "Metro" });
    const b = transactionFingerprint({ accountId: ACCOUNT, date: "2026-09-30", amountCents: -999, description: "METRO PLUS", merchantName: "Metro" });
    expect(a).toBe(b);
  });
});

describe("findDuplicate", () => {
  const coffee = existing("t-coffee", { providerTransactionId: "prov-1", date: "2026-09-30", amountCents: -250, description: "TIM HORTONS #4412" });

  it("matches on the provider transaction id first", () => {
    expect(findDuplicate({ accountId: ACCOUNT, providerTransactionId: "prov-1", date: "2026-08-01", amountCents: -999, description: "edited" }, [coffee])).toEqual({
      kind: "provider_id",
      existingId: "t-coffee",
    });
  });

  it("never matches across accounts", () => {
    expect(findDuplicate({ accountId: OTHER, providerTransactionId: "prov-1", date: "2026-09-30", amountCents: -250, description: "TIM HORTONS #4412" }, [coffee])).toBeNull();
  });

  it("links a posted transaction to its pending version", () => {
    const pending = existing("t-pending", { providerTransactionId: "pend-7", isPending: true, date: "2026-09-29", amountCents: -4512, description: "METRO PLUS" });
    expect(findDuplicate({ accountId: ACCOUNT, providerTransactionId: "post-7", pendingTransactionId: "pend-7", date: "2026-10-01", amountCents: -4600, description: "METRO PLUS #12" }, [pending])).toEqual({
      kind: "pending_to_posted",
      existingId: "t-pending",
    });
  });

  it("matches an identical CSV row by fingerprint", () => {
    const manual = existing("t-csv", { date: "2026-09-30", amountCents: -8734, description: "IGA EXTRA #8123 LAVAL QC" });
    expect(findDuplicate({ accountId: ACCOUNT, date: "2026-09-30", amountCents: -8734, description: "IGA EXTRA #8123" }, [manual])).toEqual({ kind: "fingerprint", existingId: "t-csv" });
  });

  it("keeps two identical-looking transactions that have different provider ids", () => {
    expect(findDuplicate({ accountId: ACCOUNT, providerTransactionId: "prov-2", date: "2026-09-30", amountCents: -250, description: "TIM HORTONS #4412" }, [coffee])).toBeNull();
  });

  it("fuzzy-matches a CSV row to a bank row a few days apart with a similar description", () => {
    const match = findDuplicate({ accountId: ACCOUNT, date: "2026-10-02", amountCents: -250, description: "SQ *TIM HORTONS #9981 MONTREAL QC" }, [
      existing("t-bank", { providerTransactionId: "prov-9", date: "2026-09-29", amountCents: -250, description: "TIM HORTONS 4412" }),
    ]);
    expect(match).toEqual({ kind: "fuzzy", existingId: "t-bank", score: 1 });
  });

  it("does not fuzzy-match outside the date window, on a different amount or a different merchant", () => {
    const bank = existing("t-bank", { providerTransactionId: "prov-9", date: "2026-09-29", amountCents: -250, description: "TIM HORTONS 4412" });
    expect(findDuplicate({ accountId: ACCOUNT, date: "2026-10-03", amountCents: -250, description: "TIM HORTONS" }, [bank])).toBeNull();
    expect(findDuplicate({ accountId: ACCOUNT, date: "2026-09-30", amountCents: -251, description: "TIM HORTONS" }, [bank])).toBeNull();
    expect(findDuplicate({ accountId: ACCOUNT, date: "2026-09-30", amountCents: -250, description: "SAQ SELECTION" }, [bank])).toBeNull();
  });

  it("fuzzy-matches a re-issued id only against a pending row", () => {
    const pending = existing("t-pend", { providerTransactionId: "old-id", isPending: true, date: "2026-09-29", amountCents: -1599, description: "NETFLIX.COM" });
    const posted = existing("t-post", { providerTransactionId: "old-id", isPending: false, date: "2026-09-29", amountCents: -1599, description: "NETFLIX.COM" });
    const candidate = { accountId: ACCOUNT, providerTransactionId: "new-id", date: "2026-09-30", amountCents: -1599, description: "NETFLIX COM" };
    expect(findDuplicate(candidate, [pending])).toMatchObject({ kind: "fuzzy", existingId: "t-pend" });
    expect(findDuplicate(candidate, [posted])).toBeNull();
  });

  it("picks the most similar row when several fuzzy matches exist", () => {
    const rows = [
      existing("t-weak", { date: "2026-09-30", amountCents: -4000, description: "CAFE OLIMPICO BERNARD" }),
      existing("t-strong", { date: "2026-09-30", amountCents: -4000, description: "CAFE OLIMPICO #2" }),
    ];
    expect(findDuplicate({ accountId: ACCOUNT, date: "2026-10-01", amountCents: -4000, description: "CAFE OLIMPICO" }, rows)).toMatchObject({ kind: "fuzzy", existingId: "t-strong", score: 1 });
  });

  it("lets each existing row absorb at most one candidate", () => {
    const one = existing("t-one", { date: "2026-09-30", amountCents: -250, description: "TIM HORTONS" });
    const claimed = new Set<string>();
    const candidate = { accountId: ACCOUNT, date: "2026-09-30", amountCents: -250, description: "TIM HORTONS" };
    const first = findDuplicate(candidate, [one], claimed);
    expect(first).toEqual({ kind: "fingerprint", existingId: "t-one" });
    claimed.add(first!.existingId);
    expect(findDuplicate(candidate, [one], claimed)).toBeNull();
  });

  it("returns null against an empty history", () => {
    expect(findDuplicate({ accountId: ACCOUNT, date: "2026-09-30", amountCents: -250, description: "TIM HORTONS" }, [])).toBeNull();
  });
});

describe("dedupeBatch", () => {
  it("drops repeated provider ids within an account and keeps the first", () => {
    const rows = [
      { accountId: ACCOUNT, providerTransactionId: "p1", date: "2026-09-30", amountCents: -100, description: "first" },
      { accountId: ACCOUNT, providerTransactionId: "p1", date: "2026-09-30", amountCents: -100, description: "second" },
      { accountId: OTHER, providerTransactionId: "p1", date: "2026-09-30", amountCents: -100, description: "other account" },
    ];
    const { unique, duplicates } = dedupeBatch(rows);
    expect(unique.map((r) => r.description)).toEqual(["first", "other account"]);
    expect(duplicates.map((r) => r.description)).toEqual(["second"]);
  });

  it("keeps identical rows without ids (two identical coffees are legitimate)", () => {
    const coffee = { accountId: ACCOUNT, date: "2026-09-30", amountCents: -250, description: "TIM HORTONS" };
    const { unique, duplicates } = dedupeBatch([coffee, { ...coffee }]);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("handles an empty batch", () => {
    expect(dedupeBatch([])).toEqual({ unique: [], duplicates: [] });
  });
});
