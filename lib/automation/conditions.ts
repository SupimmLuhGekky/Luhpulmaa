/**
 * Pure condition evaluation for the automation engine.
 */
import { normalizeMerchant, normalizeText } from "@/lib/transactions/normalize";

export interface EvaluableTransaction {
  merchantName: string | null;
  description: string;
  amountCents: number;
  categoryId: string | null;
  accountId: string;
  type: string;
}

export interface Condition {
  field: "MERCHANT" | "DESCRIPTION" | "AMOUNT" | "CATEGORY" | "ACCOUNT" | "TYPE";
  operator:
    | "EQUALS"
    | "NOT_EQUALS"
    | "CONTAINS"
    | "STARTS_WITH"
    | "GREATER_THAN"
    | "GREATER_THAN_OR_EQUAL"
    | "LESS_THAN"
    | "LESS_THAN_OR_EQUAL";
  /** For AMOUNT: absolute value in cents as a string ("10000" = $100). */
  value: string;
}

function textMatch(actual: string, op: Condition["operator"], expected: string): boolean {
  const a = normalizeMerchant(actual) || actual.toLowerCase();
  const e = normalizeMerchant(expected) || expected.toLowerCase();
  // Merchant keys drop words like Interac, payment or city names, so partial matches also
  // look at the whole text: "description contains Interac" matches an Interac e-transfer.
  const fullA = normalizeText(actual);
  const fullE = normalizeText(expected);
  switch (op) {
    case "EQUALS":
      return a === e;
    case "NOT_EQUALS":
      return a !== e;
    case "CONTAINS":
      return a.includes(e) || (fullE !== "" && fullA.includes(fullE));
    case "STARTS_WITH":
      return a.startsWith(e) || (fullE !== "" && fullA.startsWith(fullE));
    default:
      return false;
  }
}

/** Amount conditions compare the absolute amount ("amount > $100" matches a $120 purchase). */
function amountMatch(actualCents: number, op: Condition["operator"], expected: string): boolean {
  const e = Number(expected);
  if (!Number.isSafeInteger(e)) return false;
  const a = Math.abs(actualCents);
  switch (op) {
    case "EQUALS":
      return a === e;
    case "NOT_EQUALS":
      return a !== e;
    case "GREATER_THAN":
      return a > e;
    case "GREATER_THAN_OR_EQUAL":
      return a >= e;
    case "LESS_THAN":
      return a < e;
    case "LESS_THAN_OR_EQUAL":
      return a <= e;
    default:
      return false;
  }
}

export function evaluateCondition(t: EvaluableTransaction, c: Condition): boolean {
  switch (c.field) {
    case "MERCHANT":
      return textMatch(t.merchantName || t.description, c.operator, c.value);
    case "DESCRIPTION":
      return textMatch(t.description, c.operator, c.value);
    case "AMOUNT":
      return amountMatch(t.amountCents, c.operator, c.value);
    case "CATEGORY":
      return c.operator === "NOT_EQUALS" ? t.categoryId !== c.value : t.categoryId === c.value;
    case "ACCOUNT":
      return c.operator === "NOT_EQUALS" ? t.accountId !== c.value : t.accountId === c.value;
    case "TYPE":
      return c.operator === "NOT_EQUALS" ? t.type !== c.value : t.type === c.value;
  }
}

export function evaluateConditions(t: EvaluableTransaction, conditions: Condition[], logic: "ALL" | "ANY"): boolean {
  if (conditions.length === 0) return true;
  return logic === "ALL" ? conditions.every((c) => evaluateCondition(t, c)) : conditions.some((c) => evaluateCondition(t, c));
}

/** Planned allocation for an income transaction: percentage or fixed, optionally only above a threshold. */
export function allocationAmount(incomeCents: number, config: { percentBps?: number; amountCents?: number; aboveCents?: number }): number {
  const base = Math.max(0, incomeCents - (config.aboveCents ?? 0));
  if (base <= 0) return 0;
  if (config.amountCents) return Math.min(config.amountCents, base);
  if (config.percentBps) {
    const product = BigInt(base) * BigInt(config.percentBps);
    const q = product / 10000n;
    const r = product % 10000n;
    return Number(r * 2n >= 10000n ? q + 1n : q);
  }
  return 0;
}

/** Round-up amount: $4.35 purchase rounded to $1 → 65¢. Zero for exact amounts or inflows. */
export function roundUpAmount(amountCents: number, roundToCents = 100): number {
  if (amountCents >= 0) return 0;
  const spent = -amountCents;
  const rem = spent % roundToCents;
  return rem === 0 ? 0 : roundToCents - rem;
}
