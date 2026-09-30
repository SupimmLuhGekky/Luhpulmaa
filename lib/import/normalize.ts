/**
 * CSV import normalisation (pure). The browser parses the file and sends raw string
 * cells plus the user's column mapping; everything is validated and converted here.
 */
import { z } from "zod";
import { isLocalDate, type LocalDate } from "@/lib/dates";
import { parseMoney } from "@/lib/finance/money";

export const DATE_FORMATS = ["auto", "YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const importMappingSchema = z.object({
  date: z.number().int().min(0),
  description: z.number().int().min(0),
  /** Either a single signed amount column… */
  amount: z.number().int().min(0).nullable().optional(),
  /** …or separate debit / credit columns. */
  debit: z.number().int().min(0).nullable().optional(),
  credit: z.number().int().min(0).nullable().optional(),
  merchant: z.number().int().min(0).nullable().optional(),
  category: z.number().int().min(0).nullable().optional(),
  dateFormat: z.enum(DATE_FORMATS).default("auto"),
  /** Some banks export purchases as positive numbers. */
  invertAmounts: z.boolean().default(false),
});

export type ImportMapping = z.infer<typeof importMappingSchema>;

export const MAX_IMPORT_ROWS = 5000;

export const importPayloadSchema = z.object({
  accountId: z.string().uuid(),
  fileName: z.string().max(200).optional(),
  hasHeader: z.boolean().default(true),
  mapping: importMappingSchema,
  rows: z.array(z.array(z.string().max(500)).max(50)).min(1).max(MAX_IMPORT_ROWS + 1),
});

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function parseImportDate(raw: string, format: DateFormat): LocalDate | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  let y: number, m: number, d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  const slash = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if ((format === "auto" || format === "YYYY-MM-DD" || format === "YYYY/MM/DD") && iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (slash && format !== "YYYY-MM-DD" && format !== "YYYY/MM/DD") {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    y = Number(slash[3]);
    if (y < 100) y += 2000;
    if (format === "MM/DD/YYYY") [m, d] = [a, b];
    else if (format === "DD/MM/YYYY") [d, m] = [a, b];
    else if (a > 12) [d, m] = [a, b];
    else if (b > 12) [m, d] = [a, b];
    else [d, m] = [a, b]; // ambiguous: Canadian banks commonly use DD/MM; user can override
  } else {
    const parsed = Date.parse(s);
    if (Number.isNaN(parsed)) return null;
    const dt = new Date(parsed);
    [y, m, d] = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
  }
  const out = `${y}-${pad(m)}-${pad(d)}`;
  return isLocalDate(out) ? out : null;
}

export interface NormalizedImportRow {
  line: number;
  date: LocalDate | null;
  description: string;
  merchantName: string | null;
  amountCents: number | null;
  categoryName: string | null;
  errors: string[];
}

export function normalizeImportRows(rows: string[][], mapping: ImportMapping, hasHeader: boolean): NormalizedImportRow[] {
  const body = hasHeader ? rows.slice(1) : rows;
  return body
    .map((cells, i) => {
      const get = (idx: number | null | undefined) => (idx === null || idx === undefined ? "" : (cells[idx] ?? "").trim());
      const errors: string[] = [];
      const date = parseImportDate(get(mapping.date), mapping.dateFormat);
      if (!date) errors.push("Unrecognised date");
      const description = get(mapping.description);
      if (!description) errors.push("Missing description");
      let amount: number | null = null;
      if (mapping.amount !== null && mapping.amount !== undefined) {
        amount = parseMoney(get(mapping.amount));
      } else if (mapping.debit != null || mapping.credit != null) {
        const debit = parseMoney(get(mapping.debit)) ?? 0;
        const credit = parseMoney(get(mapping.credit)) ?? 0;
        amount = Math.abs(credit) - Math.abs(debit);
        if (!get(mapping.debit) && !get(mapping.credit)) amount = null;
      }
      if (amount === null) errors.push("Unrecognised amount");
      else if (amount === 0) errors.push("Amount is zero");
      if (amount !== null && mapping.invertAmounts) amount = -amount;
      return {
        line: i + (hasHeader ? 2 : 1),
        date,
        description: description.slice(0, 300),
        merchantName: get(mapping.merchant) || null,
        amountCents: amount,
        categoryName: get(mapping.category) || null,
        errors,
      };
    })
    .filter((r) => r.description || r.date || r.amountCents !== null);
}

/** Guesses a column mapping from header names (English and French bank exports). */
export function guessMapping(header: string[]): Partial<ImportMapping> {
  const find = (...patterns: RegExp[]) => {
    const idx = header.findIndex((h) => patterns.some((p) => p.test(h.trim().toLowerCase())));
    return idx >= 0 ? idx : null;
  };
  return {
    date: find(/^date/, /transaction date/, /date de transaction/, /^posted/) ?? 0,
    description: find(/description/, /libell/, /details/, /memo/, /^name/, /payee/) ?? 1,
    amount: find(/^amount/, /^montant/, /^value/),
    debit: find(/debit/, /withdrawal/, /retrait/),
    credit: find(/credit/, /deposit/, /d[eé]p[oô]t/),
    merchant: find(/merchant/, /marchand/, /commer/),
    category: find(/category/, /cat[eé]gorie/),
  };
}
