import { describe, expect, it, vi } from "vitest";
import type { ProviderType } from "@prisma/client";
import { suggestLinks, type MatchableLunchFlowAccount, type MatchableManualAccount } from "@/lib/accounts/lunchflow-match";
import { lunchFlowChoiceSchema, lunchFlowConnectSchema, lunchFlowPreviewSchema } from "@/lib/accounts/schemas";
import { connectedAvailableBalance, PERSON_TYPED_PROVIDERS, typeChosenByPerson } from "@/lib/accounts/types";

// The adapters read their settings lazily; nothing here calls a provider.
vi.mock("@/lib/config/env", () => ({ env: () => ({ appEnv: "test" }) }));

const lf = (providerAccountId: string, name: string, over: Partial<MatchableLunchFlowAccount> = {}): MatchableLunchFlowAccount => ({
  providerAccountId,
  name,
  institution: "Fictional Neo Financial",
  currency: "CAD",
  suggestedType: "CREDIT_CARD",
  existing: null,
  skipped: false,
  ...over,
});
const manual = (id: string, name: string, over: Partial<MatchableManualAccount> = {}): MatchableManualAccount => ({ id, name, type: "CREDIT_CARD", currency: "CAD", institution: null, ...over });

describe("suggestLinks", () => {
  it("suggests the CSV account a Lunch Flow account continues", () => {
    expect(suggestLinks([lf("9001", "Fictional Neo Mastercard"), lf("9002", "Everyday Account", { suggestedType: "CHEQUING" })], [manual("m-card", "Neo card")])).toEqual({ "9001": "m-card" });
  });

  it("matches on the institution too, and ignores accents and case", () => {
    expect(suggestLinks([lf("9001", "Mastercard", { institution: "Banque Fictive Épargne" })], [manual("m-card", "carte BANQUE FICTIVE")])).toEqual({ "9001": "m-card" });
  });

  it("needs a word that says which account, not just what kind", () => {
    expect(suggestLinks([lf("9001", "Mastercard", { institution: "Lunch Flow" })], [manual("m-card", "My credit card")])).toEqual({});
  });

  it("needs the same type and currency", () => {
    expect(suggestLinks([lf("9001", "Neo Mastercard")], [manual("m-chq", "Neo account", { type: "CHEQUING" })])).toEqual({});
    expect(suggestLinks([lf("9001", "Neo Mastercard", { currency: "USD" })], [manual("m-card", "Neo card")])).toEqual({});
  });

  it("suggests nothing when the choice is ambiguous either way", () => {
    // Two possible CSV accounts for one card.
    expect(suggestLinks([lf("9001", "Neo Mastercard")], [manual("m-1", "Neo card"), manual("m-2", "Neo secured card")])).toEqual({});
    // Two cards that could continue the same CSV account.
    expect(suggestLinks([lf("9001", "Neo Mastercard"), lf("9003", "Neo World Elite")], [manual("m-card", "Neo card")])).toEqual({});
  });

  it("leaves out accounts already in Harbour and accounts left out of the connection", () => {
    expect(suggestLinks([lf("9001", "Neo Mastercard", { existing: { id: "a-1" } }), lf("9003", "Neo Secured Mastercard", { skipped: true })], [manual("m-card", "Neo card")])).toEqual({});
  });
});

describe("person-typed accounts", () => {
  it("matches the adapters that don't report account types", async () => {
    const { MockProvider } = await import("@/lib/banking/providers/mock");
    const { PlaidProvider } = await import("@/lib/banking/providers/plaid");
    const { FlinksProvider } = await import("@/lib/banking/providers/flinks");
    const { LunchFlowProvider } = await import("@/lib/banking/providers/lunchflow");
    for (const provider of [new MockProvider(), new PlaidProvider(), new FlinksProvider(), new LunchFlowProvider()]) {
      expect(PERSON_TYPED_PROVIDERS.includes(provider.id as ProviderType)).toBe(!provider.reportsAccountTypes);
      expect(typeChosenByPerson({ isManual: false, provider: provider.id as ProviderType })).toBe(!provider.reportsAccountTypes);
    }
    expect(typeChosenByPerson({ isManual: true, provider: null })).toBe(true);
    expect(typeChosenByPerson({ isManual: false, provider: null })).toBe(false);
  });

  it("knows a card's available credit only once its limit is set", () => {
    expect(connectedAvailableBalance("CREDIT_CARD", 52_310, 200_000)).toBe(147_690);
    expect(connectedAvailableBalance("LINE_OF_CREDIT", 10_000, null)).toBeNull();
    expect(connectedAvailableBalance("CREDIT_CARD", 52_310, null)).toBeNull();
    expect(connectedAvailableBalance("CHEQUING", 184_025, null)).toBeNull();
    expect(connectedAvailableBalance("LOAN", 500_000, 1_000_000)).toBeNull();
  });
});

describe("Lunch Flow forms", () => {
  it("takes a pasted key without the spaces around it, and refuses keys with spaces inside", () => {
    expect(lunchFlowPreviewSchema.parse({ apiKey: "  lf-fictional-key\n" })).toEqual({ apiKey: "lf-fictional-key" });
    expect(lunchFlowPreviewSchema.safeParse({ apiKey: "lf fictional" }).success).toBe(false);
    expect(lunchFlowPreviewSchema.safeParse({ apiKey: "   " }).success).toBe(false);
    expect(lunchFlowPreviewSchema.safeParse({ apiKey: "k".repeat(513) }).success).toBe(false);
  });

  it("accepts a new account, a continued one or a skipped one", () => {
    expect(lunchFlowChoiceSchema.parse({ providerAccountId: "9001", action: "new", type: "CREDIT_CARD" })).toEqual({ providerAccountId: "9001", action: "new", type: "CREDIT_CARD" });
    expect(lunchFlowChoiceSchema.safeParse({ providerAccountId: "9001", action: "link", type: "CREDIT_CARD", linkAccountId: "not-a-uuid" }).success).toBe(false);
    expect(lunchFlowChoiceSchema.parse({ providerAccountId: "9002", action: "skip" })).toEqual({ providerAccountId: "9002", action: "skip" });
    expect(lunchFlowChoiceSchema.safeParse({ providerAccountId: "9001", action: "new", type: "GOLD" }).success).toBe(false);
    expect(lunchFlowConnectSchema.safeParse({ apiKey: "lf-key", accounts: Array.from({ length: 101 }, (_, i) => ({ providerAccountId: String(i), action: "skip" })) }).success).toBe(false);
  });
});
