import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { monthlyEquivalent, yearlyEquivalent } from "@/lib/finance/frequency";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), multiCurrency: { on: true } }));

vi.mock("@/lib/db/prisma", () => ({ prisma: { exchangeRate: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/flags", () => ({ isEnabled: (name: string) => (name === "ENABLE_MULTI_CURRENCY" ? mocks.multiCurrency.on : true) }));

const { convertToBase } = await import("@/lib/finance/fx");

describe("monthlyEquivalent / yearlyEquivalent", () => {
  it("converts per-occurrence amounts using occurrences per year", () => {
    expect(monthlyEquivalent(142000, "BIWEEKLY")).toBe(307667); // $1,420 × 26 / 12 = $3,076.67
    expect(monthlyEquivalent(10000, "WEEKLY")).toBe(43333);
    expect(monthlyEquivalent(10000, "SEMI_MONTHLY")).toBe(20000);
    expect(monthlyEquivalent(10000, "MONTHLY")).toBe(10000);
    expect(monthlyEquivalent(30000, "QUARTERLY")).toBe(10000);
    expect(monthlyEquivalent(12000, "YEARLY")).toBe(1000);
    expect(monthlyEquivalent(999, "YEARLY")).toBe(83); // 83.25 → 83
    expect(monthlyEquivalent(10000, "IRREGULAR")).toBe(10000);
    expect(monthlyEquivalent(10000, "ONE_TIME")).toBe(0);
    expect(monthlyEquivalent(-1599, "MONTHLY")).toBe(-1599);
    expect(monthlyEquivalent(0, "WEEKLY")).toBe(0);
  });

  it("annualises exactly", () => {
    expect(yearlyEquivalent(142000, "BIWEEKLY")).toBe(3692000);
    expect(yearlyEquivalent(1599, "MONTHLY")).toBe(19188);
    expect(yearlyEquivalent(10000, "WEEKLY")).toBe(520000);
    expect(yearlyEquivalent(10000, "ONE_TIME")).toBe(0);
  });
});

describe("convertToBase", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.multiCurrency.on = true;
  });

  it("returns the amount untouched for the same currency or when multi-currency is off", async () => {
    expect(await convertToBase("user-1", 12345, "CAD", "CAD")).toBe(12345);
    mocks.multiCurrency.on = false;
    expect(await convertToBase("user-1", 12345, "USD", "CAD")).toBe(12345);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to 1:1 when no rate is stored", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await convertToBase("user-1", 12345, "USD", "CAD")).toBe(12345);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { userId_base_quote: { userId: "user-1", base: "USD", quote: "CAD" } } });
  });

  it("applies the user's rate with half-away-from-zero rounding", async () => {
    mocks.findUnique.mockResolvedValue({ rate: new Prisma.Decimal("1.3725") });
    expect(await convertToBase("user-1", 10000, "USD", "CAD")).toBe(13725);
    expect(await convertToBase("user-1", 1, "USD", "CAD")).toBe(1); // 1.3725 → 1
    expect(await convertToBase("user-1", 2, "USD", "CAD")).toBe(3); // 2.745 → 3
    expect(await convertToBase("user-1", -2, "USD", "CAD")).toBe(-3);
    expect(await convertToBase("user-1", 0, "USD", "CAD")).toBe(0);
  });

  it("is exact for rates with eight decimals and large amounts", async () => {
    mocks.findUnique.mockResolvedValue({ rate: new Prisma.Decimal("0.73126543") });
    // 123456789 × 0.73126543 = 90279681.89… → 90279682
    expect(await convertToBase("user-1", 123456789, "CAD", "USD")).toBe(90279682);
    mocks.findUnique.mockResolvedValue({ rate: new Prisma.Decimal("0.5") });
    expect(await convertToBase("user-1", 1, "CAD", "USD")).toBe(1); // 0.5 → 1 (away from zero)
    expect(await convertToBase("user-1", -1, "CAD", "USD")).toBe(-1);
  });
});
