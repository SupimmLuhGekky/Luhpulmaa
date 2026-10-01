import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import {
  categorize,
  inferType,
  learnedCategory,
  matchMerchantRule,
  type CategorizationContext,
  type CategoryRef,
  type MerchantRuleRef,
} from "@/lib/transactions/categorization";
import { containsKeyword, matchSystemRule, SYSTEM_RULES, TRANSFER_KEYWORDS } from "@/lib/transactions/system-rules";

const categories: CategoryRef[] = DEFAULT_CATEGORIES.map((c) => ({
  id: `cat-${c.key}`,
  systemKey: c.key,
  name: c.name,
  kind: c.kind,
  subcategories: (c.subcategories ?? []).map((s) => ({ id: `sub-${c.key}-${s}`, name: s })),
}));

const ctx = (merchantRules: MerchantRuleRef[] = []): CategorizationContext => ({ categories, merchantRules });

function rule(pattern: string, categoryKey: string, over: Partial<MerchantRuleRef> = {}): MerchantRuleRef {
  return { id: `rule-${pattern}`, pattern, categoryId: `cat-${categoryKey}`, subcategoryId: null, source: "USER_DEFINED", isActive: true, correctionCount: 1, ...over };
}

const cat = (description: string, amountCents: number, extra: { merchantName?: string; categoryHint?: string } = {}, rules: MerchantRuleRef[] = []) =>
  categorize({ description, amountCents, merchantName: extra.merchantName ?? null, categoryHint: extra.categoryHint ?? null }, ctx(rules));

describe("built-in rules for Quebec merchants", () => {
  it.each([
    ["IGA EXTRA FAMILLE MARTEL #8123 LAVAL QC", "cat-groceries", null],
    ["METRO PLUS DU FORT MONTREAL", "cat-groceries", null],
    ["SAQ SELECTION 23045", "cat-entertainment", null],
    ["STM OPUS MONTREAL", "cat-transportation", "sub-transportation-Public transit"],
    ["STM-CARTE OPUS", "cat-transportation", "sub-transportation-Public transit"],
    ["HYDRO-QUÉBEC", "cat-utilities", "sub-utilities-Electricity"],
    ["HYDRO QUEBEC PAIEMENT", "cat-utilities", "sub-utilities-Electricity"],
    ["DESJARDINS ASSURANCES GENERALES", "cat-insurance", null],
    ["DESJARDINS FRAIS MENSUELS", "cat-fees", "sub-fees-Bank fees"],
    ["COUCHE-TARD #123", "cat-gas", null],
    ["JEAN COUTU #082", "cat-healthcare", "sub-healthcare-Pharmacy"],
    ["SQ *TIM HORTONS #4412 MONTREAL QC", "cat-restaurants", "sub-restaurants-Coffee"],
    ["MCDONALD'S #1234", "cat-restaurants", "sub-restaurants-Dining out"],
    ["UBER EATS", "cat-restaurants", "sub-restaurants-Delivery"],
    ["UBER TRIP", "cat-transportation", "sub-transportation-Rideshare"],
    ["NETFLIX.COM", "cat-subscriptions", "sub-subscriptions-Streaming"],
  ])("%s → %s", (description, categoryId, subcategoryId) => {
    const result = cat(description, -2500);
    expect(result).toMatchObject({ categoryId, subcategoryId, source: "SYSTEM_RULE", type: "EXPENSE", isTransfer: false });
    expect(result.label).toMatch(/^Built-in rule/);
  });

  it("recognises H&M", () => {
    expect(cat("H&M #1234 MONTREAL", -4999)).toMatchObject({ categoryId: "cat-shopping", subcategoryId: "sub-shopping-Clothing" });
  });

  it("only accepts a plural 's' at the end of a word (HMSHOST is not H&M, GYMSHARK is not a gym)", () => {
    expect(cat("HMSHOST YUL AIRPORT", -1450).categoryId).not.toBe("cat-shopping");
    expect(cat("GYMSHARK.COM", -6500).categoryId).not.toBe("cat-subscriptions");
    expect(cat("BARSTOOL SPORTS", -2500).categoryId).not.toBe("cat-entertainment");
    // Real plurals still match.
    expect(matchSystemRule("bars and grills")?.pattern).toBe("bar");
  });

  it("finds a keyword that appears as a whole word after a longer word containing it", () => {
    expect(cat("PAYPAL *BELLMEDIA BELL CANADA", -8500)).toMatchObject({ categoryId: "cat-utilities", subcategoryId: "sub-utilities-Phone" });
    expect(matchSystemRule("metropolitain metro")?.pattern).toBe("metro");
  });

  it("prefers the longest matching pattern", () => {
    expect(matchSystemRule("uber eats")?.pattern).toBe("uber eats");
    expect(matchSystemRule("desjardins assurances generales")?.pattern).toBe("desjardins assurances");
    expect(matchSystemRule("unknown merchant")).toBeNull();
  });

  it("has no duplicate patterns", () => {
    const patterns = SYSTEM_RULES.map((r) => r.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});

describe("categorization precedence", () => {
  it("1. an active user rule beats every built-in rule", () => {
    const result = cat("METRO PLUS #123", -4512, {}, [rule("metro plus", "restaurants")]);
    expect(result).toMatchObject({ categoryId: "cat-restaurants", source: "MERCHANT_RULE", ruleId: "rule-metro plus", type: "EXPENSE" });
    expect(result.label).toBe("Your rule: “metro plus”");
  });

  it("1. a user rule can match words that merchant keys drop (full text)", () => {
    const result = cat("INTERAC E-TRANSFER TO LANDLORD", -120000, {}, [rule("e transfer to landlord", "housing")]);
    expect(result).toMatchObject({ categoryId: "cat-housing", source: "MERCHANT_RULE" });
  });

  it("1. learned corrections are labelled as such and inactive rules are ignored", () => {
    expect(cat("SAQ SELECTION", -3299, {}, [rule("saq selection", "groceries", { source: "USER_CORRECTION", correctionCount: 2 })]).label).toBe("Learned from your corrections (“saq selection”)");
    expect(cat("SAQ SELECTION", -3299, {}, [rule("saq selection", "groceries", { isActive: false })])).toMatchObject({ categoryId: "cat-entertainment", source: "SYSTEM_RULE" });
  });

  it("1. a rule pointing at a deleted category falls through", () => {
    expect(cat("SAQ SELECTION", -3299, {}, [{ ...rule("saq selection", "groceries"), categoryId: "cat-deleted" }])).toMatchObject({ categoryId: "cat-entertainment" });
  });

  it("2. transfer keywords beat merchant keywords", () => {
    expect(cat("INTERNAL TRANSFER - STM", -5000)).toMatchObject({ categoryId: "cat-transfers", type: "TRANSFER", isTransfer: true, label: "Built-in rule: transfer keywords" });
    expect(cat("PAYMENT THANK YOU / PAIEMENT MERCI", 50000)).toMatchObject({ categoryId: "cat-transfers", type: "TRANSFER", isTransfer: true });
    expect(cat("VIREMENT DESJARDINS", -50000)).toMatchObject({ categoryId: "cat-transfers", isTransfer: true });
  });

  it("3. built-in rules beat the provider's category hint", () => {
    expect(cat("SAQ SELECTION", -2000, { categoryHint: "groceries" })).toMatchObject({ categoryId: "cat-entertainment", source: "SYSTEM_RULE" });
  });

  it("4. the provider hint is used when no rule matches", () => {
    expect(cat("ACME WIDGETS", -2000, { categoryHint: "shopping" })).toMatchObject({ categoryId: "cat-shopping", source: "PROVIDER" });
    expect(cat("ACME WIDGETS", -2000, { categoryHint: "not-a-key" })).toMatchObject({ categoryId: null, source: "UNCATEGORIZED" });
  });

  it("5. heuristics: income keywords, interest and money received", () => {
    expect(cat("HARBOURFRONT GRILL PAYROLL DEP", 142000)).toMatchObject({ categoryId: "cat-income", subcategoryId: "sub-income-Salary", type: "INCOME" });
    expect(cat("INTEREST PAID", 123)).toMatchObject({ categoryId: "cat-income", subcategoryId: "sub-income-Interest", type: "INCOME" });
    expect(cat("ACME CO-OP DISTRIBUTION", 5000)).toMatchObject({ categoryId: "cat-income", subcategoryId: null, label: "Built-in rule: money received", type: "INCOME" });
  });

  it("an inflow from a store is a refund in that store's category, unless it is pay", () => {
    expect(cat("METRO PLUS", 2500)).toMatchObject({ categoryId: "cat-groceries", type: "REFUND" });
    expect(cat("METRO PAYROLL", 100000)).toMatchObject({ categoryId: "cat-income", type: "INCOME" });
  });

  it("leaves unknown outflows and refunds of unknown merchants uncategorised", () => {
    expect(cat("ACME WIDGETS", -2000)).toMatchObject({ categoryId: null, subcategoryId: null, source: "UNCATEGORIZED", label: null, type: "EXPENSE" });
    expect(cat("REFUND ACME", 2000)).toMatchObject({ categoryId: null, source: "UNCATEGORIZED", type: "REFUND" });
  });

  it("uses the merchant name when present and reports the normalised merchant", () => {
    expect(cat("POS 000123 XYZ", -1000, { merchantName: "IGA" })).toMatchObject({ categoryId: "cat-groceries", normalizedMerchant: "iga" });
  });
});

describe("matchMerchantRule", () => {
  it("prefers an exact match over a contained one", () => {
    const rules = [rule("metro", "groceries"), rule("metro plus", "restaurants")];
    expect(matchMerchantRule("metro plus", rules)?.pattern).toBe("metro plus");
    expect(matchMerchantRule("metro plus du fort", rules)?.pattern).toBe("metro plus");
  });

  it("orders contained matches by user-defined, then corrections, then length", () => {
    const corrected = rule("cafe", "restaurants", { source: "USER_CORRECTION", correctionCount: 5 });
    const defined = rule("olimpico", "groceries", { source: "USER_DEFINED", correctionCount: 1 });
    expect(matchMerchantRule("cafe olimpico", [corrected, defined])?.id).toBe(defined.id);
    const many = rule("cafe", "restaurants", { source: "USER_CORRECTION", correctionCount: 5 });
    const few = rule("cafe olimpico bernard", "groceries", { source: "USER_CORRECTION", correctionCount: 2 });
    expect(matchMerchantRule("le cafe olimpico bernard", [few, many])?.id).toBe(many.id);
  });

  it("matches whole words only and ignores inactive or empty rules", () => {
    expect(matchMerchantRule("metropolitain", [rule("metro", "groceries")])).toBeNull();
    expect(matchMerchantRule("metro", [rule("metro", "groceries", { isActive: false })])).toBeNull();
    expect(matchMerchantRule("metro", [rule("", "groceries")])).toBeNull();
    expect(matchMerchantRule("", [])).toBeNull();
  });
});

describe("inferType", () => {
  const input = (description: string, amountCents: number) => ({ description, amountCents });

  it("derives the type from category kind, keywords and sign", () => {
    expect(inferType(input("ACME", -100), "acme", "TRANSFER")).toEqual({ type: "TRANSFER", isTransfer: true });
    expect(inferType(input("ONLINE TRANSFER TO SAVINGS", -100), "")).toEqual({ type: "TRANSFER", isTransfer: true });
    expect(inferType(input("AMAZON RETURN", 100), "amazon")).toEqual({ type: "REFUND", isTransfer: false });
    expect(inferType(input("ACME", 100), "acme", "EXPENSE")).toEqual({ type: "REFUND", isTransfer: false });
    expect(inferType(input("ACME", 100), "acme", "INCOME")).toEqual({ type: "INCOME", isTransfer: false });
    expect(inferType(input("ACME", 100), "acme")).toEqual({ type: "INCOME", isTransfer: false });
    expect(inferType(input("ACME", -100), "acme", "INCOME")).toEqual({ type: "EXPENSE", isTransfer: false });
    expect(inferType(input("ACME", 0), "acme")).toEqual({ type: "EXPENSE", isTransfer: false });
  });
});

describe("keyword matching", () => {
  it("recognises card payments and own-account transfers in English and French", () => {
    for (const text of ["payment thank you", "paiement merci", "visa payment cashback visa", "virement interac", "transfer to savings", "tfr to chq"]) {
      expect(containsKeyword(text, TRANSFER_KEYWORDS), text).toBe(true);
    }
    expect(containsKeyword("transferwise fees", TRANSFER_KEYWORDS)).toBe(false);
  });
});

describe("learnedCategory", () => {
  it("activates only at the learning threshold, preferring the most corrected", () => {
    expect(learnedCategory([{ categoryId: "a", count: 1 }])).toBeNull();
    expect(learnedCategory([{ categoryId: "a", count: 2 }])).toBe("a");
    expect(learnedCategory([{ categoryId: "b", count: 2 }, { categoryId: "a", count: 3 }])).toBe("a");
    expect(learnedCategory([{ categoryId: "a", count: 2 }], 3)).toBeNull();
    expect(learnedCategory([])).toBeNull();
  });
});
