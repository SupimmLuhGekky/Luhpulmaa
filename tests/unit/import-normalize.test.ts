import { describe, expect, it } from "vitest";
import { bankCategoryToSystemKey } from "@/lib/import/bank-categories";
import { guessMapping, importMappingSchema, normalizeImportRows, parseImportDate, suggestInvertAmounts } from "@/lib/import/normalize";

const mapping = (m: Record<string, unknown>) => importMappingSchema.parse(m);

describe("parseImportDate", () => {
  it.each([
    ["2026-09-30", "2026-09-30"],
    ["2026/09/30", "2026-09-30"],
    ["2026-09-30T23:41:00Z", "2026-09-30"],
    ["2026-09-30 08:15:00", "2026-09-30"],
    ["Sep 30, 2026", "2026-09-30"],
    ["September 3 2026", "2026-09-03"],
    ["30 Sep 2026", "2026-09-30"],
    ["30 sept. 2026", "2026-09-30"],
    ["1er octobre 2026", "2026-10-01"],
    ["5 févr. 2026", "2026-02-05"],
    ["30-Sep-26", "2026-09-30"],
    ["13/02/2026", "2026-02-13"],
    ["02/13/2026", "2026-02-13"],
  ])("reads %s", (raw, expected) => {
    expect(parseImportDate(raw, "auto")).toBe(expected);
  });

  it("uses the chosen format for ambiguous numeric dates", () => {
    expect(parseImportDate("03/04/2026", "auto")).toBe("2026-04-03");
    expect(parseImportDate("03/04/2026", "MM/DD/YYYY")).toBe("2026-03-04");
  });

  it("rejects impossible or unknown dates", () => {
    expect(parseImportDate("2026-02-30", "auto")).toBeNull();
    expect(parseImportDate("yesterday", "auto")).toBeNull();
    expect(parseImportDate("", "auto")).toBeNull();
  });
});

describe("guessMapping", () => {
  it("prefers the transaction date and finds status and category columns", () => {
    expect(guessMapping(["Posted Date", "Transaction Date", "Description", "Category", "Amount", "Status"])).toMatchObject({
      date: 1,
      description: 2,
      category: 3,
      amount: 4,
      status: 5,
      debit: null,
      credit: null,
    });
  });

  it("uses the merchant column as the description when there is no description", () => {
    expect(guessMapping(["Date", "Merchant", "Type", "Amount"])).toMatchObject({ description: 1, merchant: null, type: 2, amount: 3 });
  });

  it("maps separate debit and credit columns", () => {
    expect(guessMapping(["Date", "Description", "Debit", "Credit", "Balance"])).toMatchObject({ amount: null, debit: 2, credit: 3 });
  });

  it("treats a combined Debit/Credit header as a direction column", () => {
    expect(guessMapping(["Date", "Description", "Debit/Credit", "Amount"])).toMatchObject({ type: 2, debit: null, credit: null, amount: 3 });
  });

  it("understands French headers", () => {
    expect(guessMapping(["Date de transaction", "Description", "Montant", "Catégorie"])).toMatchObject({ date: 0, description: 1, amount: 2, category: 3 });
  });
});

describe("normalizeImportRows", () => {
  const header = ["Date", "Description", "Category", "Amount", "Status"];

  it("keeps signed amounts and skips pending and declined rows", () => {
    const rows = [
      header,
      ["2026-09-01", "METRO #123", "Groceries", "-54.20", "Posted"],
      ["2026-09-02", "PAYROLL", "Income", "1,875.00", "Completed"],
      ["2026-09-03", "UBER *TRIP", "Transport", "-18.40", "Pending"],
      ["2026-09-04", "AMAZON", "Shopping", "-30.00", "Declined"],
    ];
    const out = normalizeImportRows(rows, mapping({ date: 0, description: 1, category: 2, amount: 3, status: 4 }), true);
    expect(out.map((r) => [r.amountCents, r.skipReason, r.errors.length])).toEqual([
      [-5420, null, 0],
      [187500, null, 0],
      [-1840, "Pending", 0],
      [-3000, "Declined", 0],
    ]);
    expect(out[0]).toMatchObject({ line: 2, date: "2026-09-01", categoryName: "Groceries" });
  });

  it("signs unsigned amounts with a debit/credit type column", () => {
    const rows = [
      ["Date", "Description", "Type", "Amount"],
      ["2026-09-01", "Coffee", "Debit", "4.50"],
      ["2026-09-02", "Refund", "Credit", "$12.00"],
      ["2026-09-03", "Mystery", "Other", "1.00"],
    ];
    const out = normalizeImportRows(rows, mapping({ date: 0, description: 1, type: 2, amount: 3 }), true);
    expect(out.map((r) => r.amountCents)).toEqual([-450, 1200, 100]);
    expect(out[2].errors).toContain("Unrecognised debit/credit type");
  });

  it("ignores the type column when amounts are already signed", () => {
    const rows = [
      ["Date", "Description", "Type", "Amount"],
      ["2026-09-01", "Coffee", "Purchase", "-4.50"],
      ["2026-09-02", "Payment received", "Payment", "100.00"],
    ];
    const out = normalizeImportRows(rows, mapping({ date: 0, description: 1, type: 2, amount: 3 }), true);
    expect(out.map((r) => [r.amountCents, r.errors.length])).toEqual([
      [-450, 0],
      [10000, 0],
    ]);
  });

  it("combines debit and credit columns and flips signs on request", () => {
    const rows = [
      ["Date", "Description", "Debit", "Credit"],
      ["2026-09-01", "Rent", "1250.00", ""],
      ["2026-09-02", "Deposit", "", "500.00"],
      ["2026-09-03", "Nothing", "", ""],
    ];
    const out = normalizeImportRows(rows, mapping({ date: 0, description: 1, debit: 2, credit: 3 }), true);
    expect(out.map((r) => r.amountCents)).toEqual([-125000, 50000, null]);
    expect(out[2].errors).toContain("Unrecognised amount");
    const inverted = normalizeImportRows(rows.slice(0, 2), mapping({ date: 0, description: 1, debit: 2, credit: 3, invertAmounts: true }), true);
    expect(inverted[0].amountCents).toBe(125000);
  });

  it("reads French amounts", () => {
    const rows = [["Date", "Description", "Montant"], ["2026-09-01", "Épicerie", "-1 234,56 $"]];
    expect(normalizeImportRows(rows, mapping({ date: 0, description: 1, amount: 2 }), true)[0].amountCents).toBe(-123456);
  });
});

describe("suggestInvertAmounts", () => {
  const rows = [["Date", "Description", "Amount"], ["2026-09-01", "A", "10.00"], ["2026-09-02", "B", "20.00"], ["2026-09-03", "C", "5.00"], ["2026-09-04", "Payment", "-35.00"]];

  it("suggests flipping card exports that list purchases as positive", () => {
    expect(suggestInvertAmounts(rows, { amount: 2 }, true, "CREDIT_CARD")).toBe(true);
  });

  it("never flips bank accounts or files with a direction column", () => {
    expect(suggestInvertAmounts(rows, { amount: 2 }, true, "CHEQUING")).toBe(false);
    expect(suggestInvertAmounts(rows, { amount: 2, type: 1 }, true, "CREDIT_CARD")).toBe(false);
  });
});

describe("bankCategoryToSystemKey", () => {
  it.each([
    ["Restaurants", "restaurants"],
    ["Food & Drink", "restaurants"],
    ["Épicerie", "groceries"],
    ["Groceries", "groceries"],
    ["Transportation", "transportation"],
    ["Gas", "gas"],
    ["Travel", "travel"],
    ["Bills & Utilities", "utilities"],
    ["Santé", "healthcare"],
    ["Subscriptions", "subscriptions"],
    ["Transfer", "transfers"],
    ["Payroll", "income"],
  ])("maps %s", (label, key) => {
    expect(bankCategoryToSystemKey(label)).toBe(key);
  });

  it("returns null for unknown labels", () => {
    expect(bankCategoryToSystemKey("Miscellaneous")).toBeNull();
    expect(bankCategoryToSystemKey("")).toBeNull();
    expect(bankCategoryToSystemKey(null)).toBeNull();
  });
});
