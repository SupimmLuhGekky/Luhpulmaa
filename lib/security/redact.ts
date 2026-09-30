/**
 * Removes secrets from objects before they are logged or stored in audit metadata.
 */
const SENSITIVE_KEY = /(pass(word)?|secret|token|authorization|cookie|credential|api[-_]?key|access[-_]?key|private|pin|sin|ssn|card[-_]?number|cvv|account[-_]?number)/i;

export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (typeof value === "bigint") return value.toString() as T;
  if (typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
