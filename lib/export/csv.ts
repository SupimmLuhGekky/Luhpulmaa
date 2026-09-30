/**
 * RFC 4180 CSV writer. Cells that could be interpreted as formulas by spreadsheet
 * software (=, +, -, @, tab, CR at the start) are prefixed with a single quote to
 * prevent CSV/formula injection — except plain numbers, which stay numeric.
 */
export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

export function csvEscape(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (typeof value === "string" && FORMULA_START.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  // BOM so Excel opens UTF-8 (accents in "Hydro-Québec") correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
