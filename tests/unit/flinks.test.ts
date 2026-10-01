import { describe, expect, it } from "vitest";
import { isFlinksOrigin, parseFlinksMessage } from "@/lib/banking/flinks-connect";
import { mapFlinksAccountType, mapFlinksTransaction } from "@/lib/banking/providers/flinks";

const LOGIN = "8b35f6c8-e7b6-41d3-98f8-08d68b7f8d31";

describe("Flinks Connect messages", () => {
  it("reads the loginId from the REDIRECT step's url", () => {
    expect(parseFlinksMessage({ step: "REDIRECT", institution: "Neo Financial", url: `https://app.example/accounts/connect?loginId=${LOGIN}&institution=Neo%20Financial` })).toEqual({
      loginId: LOGIN,
      institution: "Neo Financial",
    });
  });

  it("reads a loginId field when present", () => {
    expect(parseFlinksMessage({ step: "REDIRECT", loginId: LOGIN })).toEqual({ loginId: LOGIN, institution: null });
  });

  it("ignores other steps and malformed ids", () => {
    expect(parseFlinksMessage({ step: "APP_MOUNTED" })).toBeNull();
    expect(parseFlinksMessage({ step: "REDIRECT", loginId: "not-a-login" })).toBeNull();
    expect(parseFlinksMessage("REDIRECT")).toBeNull();
    expect(parseFlinksMessage(null)).toBeNull();
  });

  it("only trusts the Flinks Connect origin", () => {
    expect(isFlinksOrigin("https://toolbox-iframe.private.fin.ag", "https://toolbox-iframe.private.fin.ag/v2/?demo=true")).toBe(true);
    expect(isFlinksOrigin("https://evil.example", "https://toolbox-iframe.private.fin.ag/v2/")).toBe(false);
    expect(isFlinksOrigin("https://toolbox-iframe.private.fin.ag", "not a url")).toBe(false);
  });
});

describe("Flinks data mapping", () => {
  it("signs debits as outflows and credits as inflows in exact cents", () => {
    const account = { Id: "acc-1", Currency: "CAD" };
    expect(mapFlinksTransaction({ Id: "t1", Date: "2026-09-30T00:00:00", Description: "  NEO PURCHASE  ", Debit: 12.34, Credit: null }, account)).toMatchObject({
      providerTransactionId: "t1",
      providerAccountId: "acc-1",
      date: "2026-09-30",
      amountCents: -1234,
      description: "NEO PURCHASE",
      pending: false,
    });
    expect(mapFlinksTransaction({ Id: "t2", Date: "2026-09-29", Description: "PAYMENT", Credit: 0.1 + 0.2 }, account).amountCents).toBe(30);
  });

  it("maps account types", () => {
    expect(mapFlinksAccountType({ Type: "CreditCard", Category: "Credits" })).toBe("CREDIT_CARD");
    expect(mapFlinksAccountType({ Type: "LineOfCredit" })).toBe("LINE_OF_CREDIT");
    expect(mapFlinksAccountType({ Type: "Savings", Category: "Operations" })).toBe("SAVINGS");
    expect(mapFlinksAccountType({ Type: "TFSA", Category: "Products" })).toBe("INVESTMENT");
    expect(mapFlinksAccountType({ Category: "Credits" })).toBe("CREDIT_CARD");
    expect(mapFlinksAccountType({ Type: "Chequing" })).toBe("CHEQUING");
  });
});
