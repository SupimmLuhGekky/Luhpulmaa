import { describe, expect, it } from "vitest";
import { displayMerchant } from "@/lib/transactions/normalize";

describe("displayMerchant", () => {
  it.each([
    ["SAQ 23045 MONTREAL QC", "SAQ"],
    ["STM-CARTE OPUS", "STM Carte Opus"],
    ["IGA EXTRA #8123", "IGA Extra"],
    ["MCDONALD'S #4012", "McDonalds"],
    ["PHARMAPRIX #123", "Pharmaprix"],
  ])("%s → %s", (raw, expected) => {
    expect(displayMerchant(raw)).toBe(expected);
  });
});
