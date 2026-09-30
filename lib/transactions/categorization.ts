/**
 * Transaction categorisation engine (pure).
 *
 * Resolution order — the first step that produces a category wins:
 *   1. Active user merchant rules (learned from corrections or created by the user)
 *   2. Built-in deterministic system rules (merchant keywords)
 *   3. Provider category hint (when the data provider sends one we can map)
 *   4. Heuristics: income keywords on inflows, transfer keywords
 *   5. (optional, feature-flagged) AI suggestion — applied by the caller
 * User automations with a SET_CATEGORY action run afterwards and may override.
 *
 * The engine also infers the transaction type (income/expense/transfer/refund).
 */
import type { CategorizationSource, TransactionType } from "@prisma/client";
import { normalizeMerchant, normalizeText } from "./normalize";
import { containsKeyword, INCOME_KEYWORDS, matchSystemRule, REFUND_KEYWORDS, TRANSFER_KEYWORDS } from "./system-rules";

/** Number of identical corrections before a merchant preference is learned. */
export const LEARNING_THRESHOLD = 2;

export interface CategoryRef {
  id: string;
  systemKey: string | null;
  name: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER";
  subcategories: { id: string; name: string }[];
}

export interface MerchantRuleRef {
  id: string;
  pattern: string;
  categoryId: string;
  subcategoryId: string | null;
  source: "USER_CORRECTION" | "USER_DEFINED";
  isActive: boolean;
  correctionCount: number;
}

export interface CategorizationInput {
  description: string;
  merchantName?: string | null;
  amountCents: number;
  categoryHint?: string | null;
}

export interface CategorizationResult {
  categoryId: string | null;
  subcategoryId: string | null;
  source: CategorizationSource;
  ruleId: string | null;
  label: string | null;
  type: TransactionType;
  isTransfer: boolean;
  normalizedMerchant: string;
}

export interface CategorizationContext {
  categories: CategoryRef[];
  merchantRules: MerchantRuleRef[];
}

function byKey(ctx: CategorizationContext, key: string) {
  return ctx.categories.find((c) => c.systemKey === key) ?? null;
}

function subId(cat: CategoryRef | null, name?: string) {
  if (!cat || !name) return null;
  return cat.subcategories.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

/** Matches a user merchant rule: exact normalised match first, then word-contained match. */
export function matchMerchantRule(normalized: string, rules: MerchantRuleRef[]): MerchantRuleRef | null {
  const active = rules.filter((r) => r.isActive && r.pattern);
  const exact = active.filter((r) => r.pattern === normalized);
  const pool = exact.length ? exact : active.filter((r) => ` ${normalized} `.includes(` ${r.pattern} `));
  if (!pool.length) return null;
  // Prefer explicit user rules, then the most-corrected, then the longest pattern.
  return pool.sort(
    (a, b) =>
      (a.source === "USER_DEFINED" ? 0 : 1) - (b.source === "USER_DEFINED" ? 0 : 1) ||
      b.correctionCount - a.correctionCount ||
      b.pattern.length - a.pattern.length,
  )[0];
}

export function inferType(input: CategorizationInput, normalized: string, categoryKind?: CategoryRef["kind"]): { type: TransactionType; isTransfer: boolean } {
  const text = [normalized, normalizeText(input.merchantName), normalizeText(input.description)].filter(Boolean).join(" | ");
  if (categoryKind === "TRANSFER" || containsKeyword(text, TRANSFER_KEYWORDS)) return { type: "TRANSFER", isTransfer: true };
  if (input.amountCents > 0) {
    if (containsKeyword(text, REFUND_KEYWORDS)) return { type: "REFUND", isTransfer: false };
    if (categoryKind === "EXPENSE") return { type: "REFUND", isTransfer: false };
    return { type: "INCOME", isTransfer: false };
  }
  return { type: "EXPENSE", isTransfer: false };
}

export function categorize(input: CategorizationInput, ctx: CategorizationContext): CategorizationResult {
  const normalized = normalizeMerchant(input.merchantName || input.description) || normalizeMerchant(input.description);
  // Keyword rules look at every word of the merchant and description ("hydro quebec paiement").
  const fullText = [normalized, normalizeText(input.merchantName), normalizeText(input.description)].filter(Boolean).join(" | ");
  const finish = (
    cat: CategoryRef | null,
    subcategoryId: string | null,
    source: CategorizationSource,
    ruleId: string | null,
    label: string | null,
  ): CategorizationResult => {
    const { type, isTransfer } = inferType(input, normalized, cat?.kind);
    return { categoryId: cat?.id ?? null, subcategoryId, source: cat ? source : "UNCATEGORIZED", ruleId, label: cat ? label : null, type, isTransfer, normalizedMerchant: normalized };
  };

  // 1. User merchant rules
  const userRule = matchMerchantRule(normalized, ctx.merchantRules) ?? matchMerchantRule(fullText, ctx.merchantRules);
  if (userRule) {
    const cat = ctx.categories.find((c) => c.id === userRule.categoryId) ?? null;
    if (cat) {
      const label = userRule.source === "USER_DEFINED" ? `Your rule: “${userRule.pattern}”` : `Learned from your corrections (“${userRule.pattern}”)`;
      return finish(cat, userRule.subcategoryId, "MERCHANT_RULE", userRule.id, label);
    }
  }

  // Transfers are recognised before merchant keywords ("PAYMENT THANK YOU" is not a purchase).
  if (containsKeyword(fullText, TRANSFER_KEYWORDS)) {
    const cat = byKey(ctx, "transfers");
    return finish(cat, null, "SYSTEM_RULE", null, "Built-in rule: transfer keywords");
  }

  // 2. Built-in rules — only for outflows/refunds; an inflow from "Metro" is a refund of groceries.
  const sys = matchSystemRule(normalized) ?? matchSystemRule(fullText);
  if (sys && !(input.amountCents > 0 && containsKeyword(fullText, INCOME_KEYWORDS))) {
    const cat = byKey(ctx, sys.categoryKey);
    if (cat) return finish(cat, subId(cat, sys.subcategory), "SYSTEM_RULE", null, `Built-in rule: “${sys.pattern}” → ${cat.name}`);
  }

  // 3. Provider hint (normalised to our system keys by the provider adapter)
  if (input.categoryHint) {
    const cat = byKey(ctx, input.categoryHint);
    if (cat) return finish(cat, null, "PROVIDER", null, "Category suggested by your bank data provider");
  }

  // 4. Heuristics
  if (input.amountCents > 0 && containsKeyword(fullText, INCOME_KEYWORDS)) {
    const cat = byKey(ctx, "income");
    const sub = /interest|interet|dividend/.test(fullText) ? "Interest" : "Salary";
    return finish(cat, subId(cat, sub), "SYSTEM_RULE", null, "Built-in rule: income keywords");
  }
  if (input.amountCents > 0 && !containsKeyword(fullText, REFUND_KEYWORDS)) {
    const cat = byKey(ctx, "income");
    return finish(cat, null, "SYSTEM_RULE", null, "Built-in rule: money received");
  }

  return finish(null, null, "UNCATEGORIZED", null, null);
}

/**
 * Given the history of corrections for a merchant, decides which rule should be active.
 * Returns the category id that reached the learning threshold with the most corrections.
 */
export function learnedCategory(corrections: { categoryId: string; count: number }[], threshold = LEARNING_THRESHOLD): string | null {
  const eligible = corrections.filter((c) => c.count >= threshold).sort((a, b) => b.count - a.count);
  return eligible[0]?.categoryId ?? null;
}
