import { beforeAll, describe, expect, it } from "vitest";
import { accountsCsv, transactionsCsv } from "@/lib/export/service";
import { updateTransaction } from "@/lib/transactions/service";
import { createUser, freezeTime, manualAccount, seedTransactions } from "./helpers/factory";
import { csvRecords, parseCsv } from "./helpers/csv";

/**
 * CSV exports contain only the requesting user's rows and can't smuggle spreadsheet
 * formulas: cells starting with = + - @ get a leading apostrophe, numbers stay numbers.
 */
let userId: string;
let chequing: string;
let visa: string;

const HEADER = ["Date", "Posted date", "Account", "Merchant", "Description", "Amount", "Currency", "Type", "Category", "Subcategory", "Tags", "Notes", "Pending", "Recurring", "Transfer", "Excluded", "ID"];

beforeAll(async () => {
  freezeTime();
  userId = (await createUser({ firstName: "Éloïse" })).id;
  chequing = (await manualAccount(userId, { name: "Fictional Chequing" })).id;
  visa = (await manualAccount(userId, { name: "Fictional Visa", type: "CREDIT_CARD" })).id;
  const { created } = await seedTransactions(userId, chequing, [
    { date: "2026-08-15", amountCents: -700, description: "FICTIONAL AUGUST SHOP", merchantName: "Fictional August Shop" },
    { date: "2026-09-02", amountCents: -4523, description: "IGA EXTRA #123 MONTREAL QC", merchantName: "IGA" },
    { date: "2026-09-03", amountCents: -1000, description: '=HYPERLINK("http://evil.example","click")', merchantName: '=HYPERLINK("http://evil.example","click")' },
    { date: "2026-09-04", amountCents: -2000, description: "+1 555 0100 FICTIONAL", merchantName: "+Fictional" },
    { date: "2026-09-05", amountCents: -3000, description: "-FICTIONAL MINUS", merchantName: "-Fictional" },
    { date: "2026-09-06", amountCents: -4000, description: "@SUM(A1:A2)", merchantName: "@Fictional" },
    { date: "2026-09-07", amountCents: 5000, description: "FICTIONAL REFUND, WITH COMMA", merchantName: "Fictional Store", notes: 'She said "thanks"\nsecond line' },
  ]);
  await updateTransaction(userId, created[1], { tags: ["=cmd|' /C calc'!A0"], notes: "-2+3" });
  await seedTransactions(userId, visa, [{ date: "2026-09-08", amountCents: -6000, description: "FICTIONAL VISA PURCHASE", merchantName: "Fictional Online Shop" }]);

  const other = await createUser({ firstName: "Other" });
  await seedTransactions(other.id, (await manualAccount(other.id, { name: "Other person's account" })).id, [{ date: "2026-09-02", amountCents: -999, description: "OTHER USER SECRET PURCHASE" }]);
});

describe("transactions CSV", () => {
  it("is UTF-8 with a BOM, CRLF line endings and the documented columns", async () => {
    const csv = await transactionsCsv(userId, {});
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "").includes("\n")).toBe(true); // only the quoted note holds a bare newline
    expect(parseCsv(csv.slice(1))[0]).toEqual(HEADER);
  });

  it("contains only the user's own transactions, newest first", async () => {
    const csv = await transactionsCsv(userId, {});
    const rows = csvRecords(csv);
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.Date)).toEqual(["2026-09-08", "2026-09-07", "2026-09-06", "2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02", "2026-08-15"]);
    expect(csv).not.toContain("OTHER USER SECRET");
    expect(csv).not.toContain("Other person");
  });

  it("neutralises formula-looking cells and leaves numbers alone", async () => {
    const byDate = Object.fromEntries(csvRecords(await transactionsCsv(userId, {})).map((r) => [r.Date, r]));
    expect(byDate["2026-09-03"]).toMatchObject({ Merchant: `'=HYPERLINK("http://evil.example","click")`, Description: `'=HYPERLINK("http://evil.example","click")`, Amount: "-10.00" });
    expect(byDate["2026-09-04"]).toMatchObject({ Merchant: "'+Fictional", Description: "'+1 555 0100 FICTIONAL", Amount: "-20.00" });
    expect(byDate["2026-09-05"]).toMatchObject({ Merchant: "'-Fictional", Description: "'-FICTIONAL MINUS", Amount: "-30.00" });
    expect(byDate["2026-09-06"]).toMatchObject({ Merchant: "'@Fictional", Description: "'@SUM(A1:A2)", Amount: "-40.00" });
    expect(byDate["2026-09-02"]).toMatchObject({ Tags: "'=cmd|' /C calc'!A0", Notes: "'-2+3", Amount: "-45.23", Currency: "CAD", Account: "Fictional Chequing" });
    // Commas, quotes and newlines survive quoting; a positive amount has no sign.
    expect(byDate["2026-09-07"]).toMatchObject({ Description: "FICTIONAL REFUND, WITH COMMA", Notes: 'She said "thanks"\nsecond line', Amount: "50.00" });
    expect(Object.values(byDate).every((r) => /^-?\d+\.\d{2}$/.test(r.Amount))).toBe(true);
  });

  it("filters by date range and account", async () => {
    const dates = async (q: Parameters<typeof transactionsCsv>[1]) => csvRecords(await transactionsCsv(userId, q)).map((r) => r.Date);
    expect(await dates({ from: "2026-09-03", to: "2026-09-06" })).toEqual(["2026-09-06", "2026-09-05", "2026-09-04", "2026-09-03"]);
    expect(await dates({ accountId: visa })).toEqual(["2026-09-08"]);
    expect(await dates({ accountId: [chequing, visa], from: "2026-09-07" })).toEqual(["2026-09-08", "2026-09-07"]);
  });
});

describe("accounts CSV", () => {
  it("lists only the user's accounts with plain numeric balances", async () => {
    const rows = csvRecords(await accountsCsv(userId));
    expect(rows.map((r) => [r.Account, r.Type, r["Current balance"], r.Manual])).toEqual([
      ["Fictional Chequing", "chequing", "0.00", "true"],
      ["Fictional Visa", "credit_card", "0.00", "true"],
    ]);
  });
});
