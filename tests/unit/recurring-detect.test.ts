import { describe, expect, it } from "vitest";
import { detectRecurring, keepSubscriptionChoice, type RecurringInputTxn } from "@/lib/recurring/detect";

describe("keepSubscriptionChoice", () => {
  it("lets detection decide for a new series", () => {
    expect(keepSubscriptionChoice(null, true)).toBe(true);
    expect(keepSubscriptionChoice(undefined, false)).toBe(false);
  });

  it("keeps the stored choice for a known series (the user may have marked or unmarked it)", () => {
    expect(keepSubscriptionChoice({ isSubscription: false }, true)).toBe(false);
    expect(keepSubscriptionChoice({ isSubscription: true }, false)).toBe(true);
  });
});

describe("detectRecurring", () => {
  const monthly = (merchant: string, amount: number, dates: string[]): RecurringInputTxn[] =>
    dates.map((date, i) => ({ id: `${merchant}-${i}`, date, amountCents: amount, merchantName: merchant, description: merchant.toUpperCase(), accountId: "acc", categoryId: null, isTransfer: false }));

  it("finds a stable monthly charge and projects the next date", () => {
    const txns = monthly("Netflix", -2_299, ["2026-05-08", "2026-06-08", "2026-07-08", "2026-08-08", "2026-09-08"]);
    const [s] = detectRecurring(txns, "2026-09-30");
    expect(s).toMatchObject({ direction: "OUTFLOW", frequency: "MONTHLY", lastAmountCents: -2_299, nextExpectedDate: "2026-10-08", occurrenceCount: 5 });
    expect(s.isSubscriptionLike).toBe(true);
  });

  it("ignores transfers and irregular spending", () => {
    const transfers = monthly("Transfer", -50_000, ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]).map((t) => ({ ...t, isTransfer: true }));
    const coffee = monthly("Café Olimpico", -475, ["2026-09-02", "2026-09-03", "2026-09-11", "2026-09-29"]);
    expect(detectRecurring([...transfers, ...coffee], "2026-09-30")).toEqual([]);
  });
});
