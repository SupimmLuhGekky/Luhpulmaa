/**
 * Merchant & description normalisation shared by categorisation, duplicate detection
 * and recurring detection. Pure functions.
 */

const NOISE_WORDS = new Set([
  "pos", "purchase", "achat", "debit", "credit", "visa", "mastercard", "mc", "interac", "idp", "tpv", "pmt", "payment",
  "paiement", "www", "com", "ca", "inc", "ltd", "ltee", "the", "store", "online", "recurring", "preauthorized", "pre", "auth",
  "authorized", "pad", "dd", "contactless", "tap", "retail", "sq", "tst", "ref", "no", "qc", "on", "bc", "ab", "mb", "sk", "ns",
  "nb", "nl", "pe", "montreal", "toronto", "vancouver", "laval", "quebec", "ottawa", "calgary",
]);

/** Removes accents: "Hydro-Québec" → "Hydro-Quebec". */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Canonical merchant key: lower-case ASCII words with store numbers, card fragments,
 * reference numbers and processor prefixes removed.
 * "SQ *TIM HORTONS #4412 MONTREAL QC" → "tim hortons"
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = stripAccents(raw).toLowerCase();
  s = s.replace(/^(sq|tst|sp|pp|paypal|py|ck|dd|pos|fpos|opos|idp|apos)\s*\*\s*/i, "");
  s = s.replace(/\*+/g, " ");
  s = s.replace(/#\s*\d+/g, " ");
  s = s.replace(/\b\d{3,}\b/g, " ");
  s = s.replace(/[^a-z0-9&' ]+/g, " ");
  s = s.replace(/'/g, "");
  const words = s.split(/\s+/).filter((w) => w && !NOISE_WORDS.has(w) && !/^\d+$/.test(w) && w.length > 1);
  return words.join(" ").trim().slice(0, 80);
}

/** Title-cases a normalised key for display when no better merchant name exists. */
export function displayMerchant(raw: string): string {
  const key = normalizeMerchant(raw) || raw.trim().toLowerCase();
  return key.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (_m, c: string) => `Mc${c.toUpperCase()}`);
}

/** Levenshtein distance (iterative, O(n·m) with two rows). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Similarity in [0, 1] combining token overlap and edit distance of normalised strings. */
export function merchantSimilarity(a: string, b: string): number {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return na === nb ? 1 : 0;
  if (na === nb) return 1;
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.9;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = inter / (ta.size + tb.size - inter);
  const edit = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return Math.max(jaccard, edit);
}
