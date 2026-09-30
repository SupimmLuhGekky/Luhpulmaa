/**
 * Money primitives.
 *
 * All monetary values inside the application are integer minor units ("cents")
 * held in a JavaScript `number`. Integers are represented exactly up to
 * Number.MAX_SAFE_INTEGER (≈ $90 trillion), and every operation here is either
 * integer addition/subtraction (exact) or goes through `mulDiv`, which performs
 * the multiplication and division in BigInt and rounds explicitly. Floating-point
 * arithmetic is never used on money.
 */

export type Cents = number;

export const DEFAULT_CURRENCY = "CAD";
export const DEFAULT_LOCALE = "en-CA";
export const SUPPORTED_CURRENCIES = ["CAD", "USD", "EUR", "GBP"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Basis points: 10000 = 100%. */
export type Bps = number;
export const BPS_100 = 10000;

function assertSafeInteger(value: number, label = "value"): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer amount of cents, got ${value}`);
  }
}

/** Converts a database BigInt (or number) to cents, asserting it is safely representable. */
export function toCents(value: bigint | number | null | undefined): Cents {
  if (value === null || value === undefined) return 0;
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError("Monetary value exceeds safe integer range");
    }
    return Number(value);
  }
  assertSafeInteger(value);
  return value;
}

export function toCentsOrNull(value: bigint | number | null | undefined): Cents | null {
  return value === null || value === undefined ? null : toCents(value);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) {
    assertSafeInteger(v, "addend");
    total += v;
  }
  assertSafeInteger(total, "sum");
  return total;
}

/** Rounds a BigInt division half away from zero. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Computes round(a * b / c) exactly, rounding half away from zero. */
export function mulDiv(a: number, b: number, c: number): number {
  assertSafeInteger(a, "a");
  assertSafeInteger(b, "b");
  assertSafeInteger(c, "c");
  const result = divRound(BigInt(a) * BigInt(b), BigInt(c));
  return toCents(result);
}

/** `bps` basis points of an amount, e.g. percentOf(150000, 1500) = 22500 (15% of $1,500). */
export function percentOf(cents: Cents, bps: Bps): Cents {
  return mulDiv(cents, bps, BPS_100);
}

/** Ratio of part to whole in basis points (0 when whole is 0). */
export function ratioBps(part: Cents, whole: Cents): Bps {
  if (whole === 0) return 0;
  return mulDiv(part, BPS_100, whole);
}

/** Formats basis points as a percentage string ("32.7%"). */
export function formatBps(bps: Bps, fractionDigits = 1, locale = DEFAULT_LOCALE): string {
  const negative = bps < 0;
  const abs = Math.abs(bps);
  // bps / 100 = percent with two decimals. Round to requested digits using integers.
  const scale = 10 ** Math.max(0, 2 - fractionDigits);
  const roundedHundredths = Number(divRound(BigInt(abs), BigInt(scale))) * scale;
  const whole = Math.floor(roundedHundredths / 100);
  const frac = String(roundedHundredths % 100).padStart(2, "0").slice(0, fractionDigits);
  const decimalSep = locale.startsWith("fr") ? "," : ".";
  const body = fractionDigits > 0 ? `${whole}${decimalSep}${frac}` : `${whole}`;
  const space = locale.startsWith("fr") ? " " : "";
  return `${negative ? "-" : ""}${body}${space}%`;
}

/** Converts cents to a decimal string ("-1234.56") without floating-point math. */
export function centsToDecimalString(cents: Cents): string {
  assertSafeInteger(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(locale: string, currency: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${currency}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency, ...options });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export interface FormatCurrencyOptions {
  currency?: string;
  locale?: string;
  /** Show "+" for positive values. */
  signed?: boolean;
  /** Drop the cents when the amount is a whole number of dollars. */
  hideZeroCents?: boolean;
  /** Always drop cents (rounds half away from zero). */
  wholeDollars?: boolean;
  /** Compact notation ($24.8K). Display only. */
  compact?: boolean;
}

/**
 * Formats cents as a localized currency string ("$24,820.42", "24 820,42 $").
 * The value is passed to Intl as an exact decimal string, never as a float.
 */
export function formatCurrency(cents: Cents, opts: FormatCurrencyOptions = {}): string {
  const { currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE, signed, hideZeroCents, wholeDollars, compact } = opts;
  const noCents = wholeDollars || (hideZeroCents && cents % 100 === 0);
  const value = wholeDollars ? String(toCents(divRound(BigInt(cents), 100n))) : centsToDecimalString(cents);
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: noCents ? 0 : 2,
    maximumFractionDigits: noCents ? 0 : 2,
    signDisplay: signed ? "exceptZero" : "auto",
  };
  if (compact) {
    options.notation = "compact";
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = 1;
  }
  // Intl.NumberFormat.format accepts decimal strings exactly (ES2023); the cast
  // is needed because lib.dom typings still declare `number | bigint`.
  return getFormatter(locale, currency, options).format(value as unknown as number);
}

/**
 * Parses user-entered money into cents. Accepts "$1,234.56", "1234.5", "-12",
 * "(45.10)", "1 234,56 $" (fr-CA) and "12.345" (rounded half-up to 12.35).
 * Returns null for anything that is not an unambiguous amount.
 */
export function parseMoney(input: string | number | null | undefined, locale = DEFAULT_LOCALE): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // Numbers only arrive from trusted internal callers; go through the string path for exact rounding.
    return parseMoney(input.toFixed(6), "en-CA");
  }
  let s = input.trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\s  ]/g, "").replace(/(CAD|USD|EUR|GBP|CA\$|US\$|\$|€|£)/gi, "");
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!s) return null;

  const french = locale.startsWith("fr");
  let decimalSep: "." | ",";
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastComma >= 0) {
    // fr-CA always uses a decimal comma. In English, "12,34" is decimal but "1,234" is thousands.
    const digitsAfter = s.length - lastComma - 1;
    const commaCount = s.split(",").length - 1;
    decimalSep = french || (commaCount === 1 && digitsAfter !== 3) ? "," : ".";
  } else {
    decimalSep = ".";
  }
  const thousandsSep = decimalSep === "." ? "," : ".";
  s = s.split(thousandsSep).join("");
  if (decimalSep === ",") s = s.replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const [wholePart = "0", fracPart = ""] = s.split(".");
  const whole = BigInt(wholePart || "0");
  const fracPadded = (fracPart + "000").slice(0, 3);
  const thousandths = BigInt(fracPadded);
  // Round the third decimal half-up.
  let cents = whole * 100n + thousandths / 10n + (thousandths % 10n >= 5n ? 1n : 0n);
  // Anything beyond 3 decimals is ignored after rounding at the 3rd — acceptable for UI input,
  // but reject absurd precision to avoid silent surprises.
  if (fracPart.length > 6) return null;
  if (negative) cents = -cents;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(cents);
}

/** Splits `total` across weights using the largest-remainder method so parts always sum to total. */
export function allocateByWeights(total: Cents, weights: number[]): Cents[] {
  assertSafeInteger(total, "total");
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => {
    const product = BigInt(total) * BigInt(w);
    const q = product / BigInt(weightSum);
    const r = product % BigInt(weightSum);
    return { q: Number(q), r: r < 0n ? -r : r };
  });
  let remainder = total - raw.reduce((a, b) => a + b.q, 0);
  const order = raw.map((x, i) => ({ i, r: x.r })).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  const result = raw.map((x) => x.q);
  const step = remainder >= 0 ? 1 : -1;
  for (let k = 0; remainder !== 0 && k < order.length; k++) {
    result[order[k].i] += step;
    remainder -= step;
  }
  return result;
}

export function absCents(c: Cents): Cents {
  return Math.abs(c);
}

export function minCents(...values: Cents[]): Cents {
  return Math.min(...values);
}

export function maxCents(...values: Cents[]): Cents {
  return Math.max(...values);
}
