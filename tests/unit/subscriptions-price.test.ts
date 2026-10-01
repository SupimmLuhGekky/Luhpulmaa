import { describe, expect, it } from "vitest";
import { detectPriceChange } from "@/lib/subscriptions/price";

describe("detectPriceChange", () => {
  it("reports a change between the two latest charges", () => {
    const charges = [
      { date: "2026-07-08", amountCents: 1_999 },
      { date: "2026-08-08", amountCents: 1_999 },
      { date: "2026-09-08", amountCents: 2_299 },
    ];
    expect(detectPriceChange(charges)).toEqual({ previousCents: 1_999, currentCents: 2_299, changedOn: "2026-09-08" });
  });

  it("is order-independent and accepts signed amounts", () => {
    expect(detectPriceChange([{ date: "2026-09-08", amountCents: -2_299 }, { date: "2026-08-08", amountCents: -1_999 }])).toMatchObject({ previousCents: 1_999, currentCents: 2_299 });
  });

  it("stops reporting once the new price has been charged twice", () => {
    const charges = [
      { date: "2026-08-08", amountCents: 1_999 },
      { date: "2026-09-08", amountCents: 2_299 },
      { date: "2026-10-08", amountCents: 2_299 },
    ];
    expect(detectPriceChange(charges)).toBeNull();
  });

  it("ignores small differences and single charges", () => {
    expect(detectPriceChange([{ date: "2026-08-08", amountCents: 1_999 }, { date: "2026-09-08", amountCents: 2_019 }])).toBeNull();
    expect(detectPriceChange([{ date: "2026-08-08", amountCents: 60_000 }, { date: "2026-09-08", amountCents: 60_900 }])).toBeNull();
    expect(detectPriceChange([{ date: "2026-09-08", amountCents: 1_999 }])).toBeNull();
    expect(detectPriceChange([])).toBeNull();
  });

  it("sums same-day rows into one charge", () => {
    const charges = [
      { date: "2026-08-08", amountCents: 1_000 },
      { date: "2026-09-08", amountCents: 500 },
      { date: "2026-09-08", amountCents: 500 },
    ];
    expect(detectPriceChange(charges)).toBeNull();
  });
});
