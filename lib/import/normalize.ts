/**
 * CSV import normalisation (pure). The browser parses the file and sends raw string
 * cells plus the user's column mapping; everything is validated and converted here.
 *
 * Bank exports differ a lot (and some, like Neo Financial's, don't publish their
 * layout), so the importer is tolerant: it guesses the mapping from header names in
 * English and French, understands signed amounts, separate debit/credit columns, or
 * unsigned amounts plus a debit/credit "type" column, skips pending and declined
 * rows when a status column exists, and reads ISO, numeric and month-name dates.
 */
import { z } from "zod";
import { isLocalDate, type LocalDate } from "@/lib/dates";
import { parseMoney } from "@/lib/finance/money";

export const DATE_FORMATS = ["auto", "YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const column = z.number().int().min(0).nullable().optional();

export const importMappingSchema = z.object({
  date: z.number().int().min(0),
  description: z.number().int().min(0),
  /** Either a single amount column… */
  amount: column,
  /** …or separate debit / credit columns. */
  debit: column,
  credit: column,
  /** Optional "Debit"/"Credit" (or "Purchase"/"Refund"…) column used when amounts are unsigned. */
  type: column,
  /** Optional status column; pending, declined and reversed rows are skipped. */
  status: column,
  merchant: column,
  category: column,
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

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, january: 1, janvier: 1,
  feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2,
  mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, april: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, july: 7, juillet: 7,
  aug: 8, aou: 8, aout: 8, august: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

function plain(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function monthNumber(word: string): number | null {
  return MONTHS[plain(word).replace(/\.$/, "")] ?? null;
}

export function parseImportDate(raw: string, format: DateFormat): LocalDate | null {
  let s = raw.trim();
  if (!s) return null;
  // ISO date-times keep the calendar date as written (no time-zone shifting).
  const isoDateTime = /^(\d{4}-\d{2}-\d{2})[T\s]\d{1,2}:\d{2}/.exec(s);
  if (isoDateTime) s = isoDateTime[1];
  s = s.replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  let y: number, m: number, d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  const slash = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  // "Sep 30, 2026", "September 30 2026"
  const monthFirst = /^([A-Za-zÀ-ÿ]+\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  // "30 Sep 2026", "30 sept. 2026", "30-Sep-2026", "1er octobre 2026"
  const dayFirst = /^(\d{1,2})(?:er)?[\s-]+([A-Za-zÀ-ÿ]+\.?)[\s-]+(\d{2,4})$/.exec(s);
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
  } else if (monthFirst && monthNumber(monthFirst[1])) {
    [y, m, d] = [Number(monthFirst[3]), monthNumber(monthFirst[1])!, Number(monthFirst[2])];
  } else if (dayFirst && monthNumber(dayFirst[2])) {
    y = Number(dayFirst[3]);
    if (y < 100) y += 2000;
    [m, d] = [monthNumber(dayFirst[2])!, Number(dayFirst[1])];
  } else {
    return null;
  }
  const out = `${y}-${pad(m)}-${pad(d)}`;
  return isLocalDate(out) ? out : null;
}

/** Money-out / money-in words used by "type" columns (English and French). */
const DEBIT_WORDS = new Set(["debit", "dr", "withdrawal", "retrait", "purchase", "achat", "charge", "sent", "envoye", "out", "sortie"]);
const CREDIT_WORDS = new Set(["credit", "cr", "deposit", "depot", "refund", "remboursement", "received", "recu", "in", "entree"]);

export function directionFromType(value: string): -1 | 1 | null {
  const v = plain(value);
  if (DEBIT_WORDS.has(v)) return -1;
  if (CREDIT_WORDS.has(v)) return 1;
  return null;
}

/** Rows that never moved money (or will reappear once posted) are skipped. */
export function skipReasonForStatus(value: string): string | null {
  const v = plain(value);
  if (!v) return null;
  if (/declin|refus|reject/.test(v)) return "Declined";
  if (/revers|cancel|annul|void/.test(v)) return "Cancelled";
  if (/pend|attente|authori[sz]|hold|processing|en cours/.test(v)) return "Pending";
  return null;
}

export interface NormalizedImportRow {
  line: number;
  date: LocalDate | null;
  description: string;
  merchantName: string | null;
  amountCents: number | null;
  categoryName: string | null;
  /** Set when the row is intentionally left out (pending, declined…). */
  skipReason: string | null;
  errors: string[];
}

export function normalizeImportRows(rows: string[][], mapping: ImportMapping, hasHeader: boolean): NormalizedImportRow[] {
  const body = hasHeader ? rows.slice(1) : rows;
  const cell = (cells: string[], idx: number | null | undefined) => (idx === null || idx === undefined ? "" : (cells[idx] ?? "").trim());
  const singleAmount = mapping.amount !== null && mapping.amount !== undefined;
  // A type column only decides the sign when the file's amounts are all unsigned.
  const useTypeColumn =
    singleAmount &&
    mapping.type !== null &&
    mapping.type !== undefined &&
    !body.some((cells) => (parseMoney(cell(cells, mapping.amount)) ?? 0) < 0);

  return body
    .map((cells, i) => {
      const get = (idx: number | null | undefined) => cell(cells, idx);
      const errors: string[] = [];
      const date = parseImportDate(get(mapping.date), mapping.dateFormat);
      if (!date) errors.push("Unrecognised date");
      const description = get(mapping.description) || get(mapping.merchant);
      if (!description) errors.push("Missing description");
      let amount: number | null = null;
      if (singleAmount) {
        amount = parseMoney(get(mapping.amount));
        if (amount !== null && useTypeColumn) {
          const direction = directionFromType(get(mapping.type));
          if (direction === null) errors.push("Unrecognised debit/credit type");
          else amount = Math.abs(amount) * direction;
        }
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
        skipReason: skipReasonForStatus(get(mapping.status)),
        errors,
      };
    })
    .filter((r) => r.description || r.date || r.amountCents !== null);
}

/** Guesses a column mapping from header names (English and French bank exports). */
export function guessMapping(header: string[]): Partial<ImportMapping> {
  const names = header.map(plain);
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const idx = names.findIndex((h) => p.test(h));
      if (idx >= 0) return idx;
    }
    return null;
  };
  // Prefer the transaction date over the posting date when a file has both.
  const date = find(/^(transaction )?date$/, /^date (de |d')?(la )?transaction/, /transaction date/, /^date/, /^posted/, /date/) ?? 0;
  let debit = find(/^debit/, /^withdrawal/, /^retrait/, /money out/, /^sortie/);
  let credit = find(/^credit/, /^deposit/, /^depot/, /money in/, /^entree/);
  let type = find(/^type$/, /transaction type/, /type de transaction/, /^debit ?\/ ?credit/, /^credit ?\/ ?debit/, /^dr ?\/ ?cr/);
  // "Debit/Credit" style headers name a single direction column, not two amount columns.
  if (debit !== null && debit === credit) {
    type ??= debit;
    debit = credit = null;
  }
  const amount = find(/^amount/, /^montant/, /^value/, /^valeur/, /amount/);
  const merchant = find(/merchant/, /marchand/, /commer/, /^payee/, /beneficiaire/);
  let description = find(/^description/, /libell/, /^details/, /memo/, /^name/, /^nom/, /description/);
  if (description === null) description = merchant;
  return {
    date,
    description: description ?? 1,
    amount,
    debit: amount === null ? debit : null,
    credit: amount === null ? credit : null,
    type,
    status: find(/^status/, /^statut/, /^etat/, /^state$/),
    merchant: merchant !== description ? merchant : null,
    category: find(/category/, /categorie/),
  };
}

/**
 * Credit card exports often list purchases as positive numbers. For card and
 * credit-line accounts with a single signed amount column, suggest flipping signs
 * when most amounts are positive. The user always sees and can change this.
 */
export function suggestInvertAmounts(rows: string[][], mapping: Partial<ImportMapping>, hasHeader: boolean, accountType: string): boolean {
  if (!["CREDIT_CARD", "LINE_OF_CREDIT"].includes(accountType)) return false;
  if (mapping.amount === null || mapping.amount === undefined || (mapping.type !== null && mapping.type !== undefined)) return false;
  const amounts = (hasHeader ? rows.slice(1) : rows).map((r) => parseMoney((r[mapping.amount!] ?? "").trim())).filter((a): a is number => a !== null && a !== 0);
  if (amounts.length < 3) return false;
  return amounts.filter((a) => a > 0).length / amounts.length >= 0.7;
}
