/**
 * Percentages typed by people ("12.5", "12,5 %", "10") ↔ basis points (1250).
 * No floating point: the text is split into whole and fractional digits.
 */

/** Parses a percentage with up to two decimals into basis points, or null when it isn't one. */
export function parsePercentToBps(text: string, maxBps = 10000): number | null {
  const s = text.replace(/[\s  %]/g, "").replace(",", ".");
  if (!/^\d{1,5}(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const [whole = "", frac = ""] = s.split(".");
  const bps = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  return bps > maxBps ? null : bps;
}

/** Basis points as an editable percentage ("12.5", "10"), using the locale's decimal mark. */
export function formatBpsInput(bps: number | null | undefined, locale = "en-CA"): string {
  if (bps === null || bps === undefined) return "";
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}${locale.startsWith("fr") ? "," : "."}${frac}` : String(whole);
}
