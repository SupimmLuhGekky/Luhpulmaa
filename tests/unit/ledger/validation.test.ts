import { describe, expect, it } from "vitest";
import type { JournalEntryInput, LedgerLine } from "@/lib/ledger/types";
import { LedgerValidationError, validateJournalEntry } from "@/lib/ledger/validation";

const line = (accountCode: string, direction: LedgerLine["direction"], amountCents: number, currency = "CAD"): LedgerLine => ({ accountCode, direction, amountCents, currency });

const entry = (lines: LedgerLine[], over: Partial<JournalEntryInput> = {}): JournalEntryInput => ({
  idempotencyKey: "deposit:fictional-001",
  description: "Customer deposit",
  effectiveAt: new Date("2026-10-01T12:00:00Z"),
  lines,
  ...over,
});

const rejects = (e: JournalEntryInput, message: RegExp) => {
  expect(() => validateJournalEntry(e)).toThrow(LedgerValidationError);
  expect(() => validateJournalEntry(e)).toThrow(message);
};

describe("validateJournalEntry", () => {
  it("accepts a balanced two-line entry", () => {
    expect(() => validateJournalEntry(entry([line("1000-cash", "DEBIT", 50000), line("2000-deposits", "CREDIT", 50000)]))).not.toThrow();
  });

  it("accepts balanced multi-line entries", () => {
    expect(() =>
      validateJournalEntry(entry([line("1000-cash", "DEBIT", 30000), line("1000-cash", "DEBIT", 20000), line("2000-deposits", "CREDIT", 45000), line("4000-fees", "CREDIT", 5000)])),
    ).not.toThrow();
  });

  it("rejects unbalanced entries, even by one cent", () => {
    rejects(entry([line("1000-cash", "DEBIT", 50000), line("2000-deposits", "CREDIT", 49999)]), /Unbalanced entry: debits 50000 ≠ credits 49999/);
  });

  it("needs both sides", () => {
    rejects(entry([line("1000-cash", "DEBIT", 100), line("1001-cash", "DEBIT", 100)]), /both debit and credit/);
    rejects(entry([line("2000-deposits", "CREDIT", 100), line("2001-deposits", "CREDIT", 100)]), /both debit and credit/);
  });

  it("needs at least two lines", () => {
    rejects(entry([line("1000-cash", "DEBIT", 100)]), /at least two lines/);
    rejects(entry([]), /at least two lines/);
  });

  it("only takes positive whole cents", () => {
    for (const bad of [0, -100, 10.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      rejects(entry([line("1000-cash", "DEBIT", bad), line("2000-deposits", "CREDIT", 100)]), /positive whole cents/);
    }
  });

  it("does not overflow when totals exceed the safe integer range", () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(() => validateJournalEntry(entry([line("1000-cash", "DEBIT", big), line("1000-cash", "DEBIT", big), line("2000-deposits", "CREDIT", big), line("2000-deposits", "CREDIT", big)]))).not.toThrow();
    rejects(entry([line("1000-cash", "DEBIT", big), line("1000-cash", "DEBIT", big), line("2000-deposits", "CREDIT", big), line("2000-deposits", "CREDIT", big - 1)]), /Unbalanced/);
  });

  it("requires one currency per entry", () => {
    rejects(entry([line("1000-cash", "DEBIT", 100, "CAD"), line("2000-deposits", "CREDIT", 100, "USD")]), /one currency/);
  });

  it("requires an idempotency key, a description and account codes", () => {
    const lines = [line("1000-cash", "DEBIT", 100), line("2000-deposits", "CREDIT", 100)];
    rejects(entry(lines, { idempotencyKey: "  " }), /idempotency key/);
    rejects(entry(lines, { description: "" }), /description/);
    rejects(entry([line(" ", "DEBIT", 100), line("2000-deposits", "CREDIT", 100)]), /account code/);
  });
});
