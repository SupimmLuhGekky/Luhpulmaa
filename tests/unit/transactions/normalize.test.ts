import { describe, expect, it } from "vitest";
import { levenshtein, merchantSimilarity, normalizeMerchant, normalizeText, stripAccents } from "@/lib/transactions/normalize";

describe("normalizeMerchant", () => {
  it.each([
    ["SQ *TIM HORTONS #4412 MONTREAL QC", "tim hortons"],
    ["TST* CAFE OLIMPICO 0012", "cafe olimpico"],
    ["PAYPAL *SPOTIFY", "spotify"],
    ["IGA EXTRA FAMILLE MARTEL #8123 LAVAL QC", "iga extra famille martel"],
    ["SAQ SELECTION 23045", "saq selection"],
    ["STM OPUS MONTREAL", "stm opus"],
    ["HYDRO-QUÉBEC", "hydro"], // "quebec" is a city/province noise word for merchant keys
    ["Café Dépôt Saint-Hubert", "cafe depot saint hubert"],
    ["MCDONALD'S #1234", "mcdonalds"],
    ["H&M #1234 MONTREAL", "h&m"],
    ["INTERAC PURCHASE - METRO PLUS", "metro plus"],
    ["NETFLIX.COM", "netflix"],
    ["APPLE.COM/BILL", "apple bill"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeMerchant(raw)).toBe(expected);
  });

  it("returns an empty key for empty or all-noise input", () => {
    expect(normalizeMerchant(null)).toBe("");
    expect(normalizeMerchant(undefined)).toBe("");
    expect(normalizeMerchant("")).toBe("");
    expect(normalizeMerchant("POS PURCHASE #1234 QC")).toBe("");
    expect(normalizeMerchant("A B C")).toBe("");
  });

  it("caps the key at 80 characters", () => {
    expect(normalizeMerchant("word ".repeat(40)).length).toBeLessThanOrEqual(80);
  });
});

describe("normalizeText", () => {
  it("keeps every word, including the ones merchant keys drop", () => {
    expect(normalizeText("Hydro-Québec Paiement #123")).toBe("hydro quebec paiement 123");
    expect(normalizeText("PAYMENT THANK YOU / PAIEMENT MERCI")).toBe("payment thank you paiement merci");
    expect(normalizeText("  A&W   Montréal ")).toBe("a&w montreal");
    expect(normalizeText(null)).toBe("");
  });

  it("strips accents", () => {
    expect(stripAccents("Hydro-Québec, Énergir, Brasserie à l'œil")).toBe("Hydro-Quebec, Energir, Brasserie a l'œil");
  });
});

describe("levenshtein", () => {
  it("computes edit distances", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("metro", "metro")).toBe(0);
    expect(levenshtein("flaw", "lawn")).toBe(2);
  });
});

describe("merchantSimilarity", () => {
  it("treats store numbers, processor prefixes and cities as the same merchant", () => {
    expect(merchantSimilarity("TIM HORTONS #4412", "SQ *TIM HORTONS #9981 MONTREAL QC")).toBe(1);
  });

  it("scores prefixes highly and unrelated merchants low", () => {
    expect(merchantSimilarity("METRO PLUS", "METRO")).toBe(0.9);
    expect(merchantSimilarity("IGA", "SAQ")).toBe(0);
    expect(merchantSimilarity("Provigo Le Marché", "Maxi & Cie")).toBeLessThan(0.5);
    expect(merchantSimilarity("STARBUCKS COFFEE", "STARBUCKS CAFE")).toBeGreaterThanOrEqual(0.5);
  });

  it("is 1 only when both keys are empty", () => {
    expect(merchantSimilarity("", "")).toBe(1);
    expect(merchantSimilarity("#123", "ABC")).toBe(0);
  });

  it("is symmetric", () => {
    const pairs: [string, string][] = [
      ["CAFE OLIMPICO", "CAFE OLIMPICO BERNARD"],
      ["COUCHE-TARD #123", "COUCHE TARD 456"],
      ["UBER TRIP", "UBER EATS"],
    ];
    for (const [a, b] of pairs) expect(merchantSimilarity(a, b)).toBe(merchantSimilarity(b, a));
  });
});
