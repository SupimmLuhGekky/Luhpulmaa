/**
 * Removes secrets from objects before they are logged or stored in audit metadata.
 */
const SENSITIVE_KEY = /(pass(word)?|secret|token|authorization|cookie|credential|api[-_]?key|access[-_]?key|private|card[-_]?number|account[-_]?number)/i;
// Short names that also appear inside ordinary keys (business, shipping), so they only count as whole words.
const SENSITIVE_WORDS = new Set(["pin", "sin", "ssn", "cvv", "cvc"]);

/** The words of a key: "userPin" → user, pin; "PINCode" → pin, code; "card_cvv" → card, cvv. */
function keyWords(key: string): string[] {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || keyWords(key).some((w) => SENSITIVE_WORDS.has(w));
}

export function redact<T>(value: T, depth = 0): T {
  if (value === null || value === undefined) return value;
  // Past the depth limit, drop nested structures instead of returning them unredacted.
  if (depth > 6) return (typeof value === "object" && !(value instanceof Date) ? "[TRUNCATED]" : value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (typeof value === "bigint") return value.toString() as T;
  if (typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
