import { describe, expect, it } from "vitest";
import {
  allocateByWeights,
  centsToDecimalString,
  formatBps,
  formatCurrency,
  mulDiv,
  parseMoney,
  percentOf,
  ratioBps,
  sumCents,
  toCents,
  toCentsOrNull,
} from "@/lib/finance/money";

/** Intl uses no-break spaces in fr-CA; compare with plain spaces. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("parseMoney", () => {
  it.each([
    ["$1,234.56", 123456],
    ["1234.5", 123450],
    ["1234", 123400],
    ["-12", -1200],
    ["12-", -1200],
    ["(45.10)", -4510],
    ["+7.25", 725],
    [".5", 50],
    ["0", 0],
    ["CAD 25.00", 2500],
    ["US$ 9.99", 999],
    ["1,234,567.89", 123456789],
    ["1.234,56", 123456],
  ])("parses %j as %i cents (en-CA)", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it("parses French-Canadian amounts with spaces, no-break spaces and a decimal comma", () => {
    expect(parseMoney("1 234,56 $", "fr-CA")).toBe(123456);
    expect(parseMoney("1 234,56 $", "fr-CA")).toBe(123456);
    expect(parseMoney("1 234,56 $", "fr-CA")).toBe(123456);
    expect(parseMoney("−5,00", "fr-CA")).toBe(-500);
    // fr-CA always reads the comma as the decimal separator.
    expect(parseMoney("1,234", "fr-CA")).toBe(123);
  });

  it("disambiguates a lone comma in English: thousands when followed by 3 digits, decimal otherwise", () => {
    expect(parseMoney("1,234")).toBe(123400);
    expect(parseMoney("12,34")).toBe(1234);
    expect(parseMoney("12,5")).toBe(1250);
  });

  it("rounds the third decimal half-up and rejects absurd precision", () => {
    expect(parseMoney("12.345")).toBe(1235);
    expect(parseMoney("12.344")).toBe(1234);
    expect(parseMoney("0.005")).toBe(1);
    expect(parseMoney("0.004999")).toBe(0);
    expect(parseMoney("-12.345")).toBe(-1235);
    expect(parseMoney("1.234567")).toBe(123);
    expect(parseMoney("1.2345678")).toBeNull();
  });

  it("goes through exact decimal rounding for numbers (no float drift)", () => {
    expect(parseMoney(0.1 + 0.2)).toBe(30);
    expect(parseMoney(12.345)).toBe(1235);
    expect(parseMoney(-19.99)).toBe(-1999);
    expect(parseMoney(1.005)).toBe(101);
    expect(parseMoney(Number.NaN)).toBeNull();
    expect(parseMoney(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns null for empty or non-numeric input", () => {
    for (const bad of [null, undefined, "", "   ", "abc", "$", "1.5.5", "--5", "12abc", "1e5", "-", "()"]) {
      expect(parseMoney(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it("never returns negative zero", () => {
    expect(Object.is(parseMoney("-0"), 0)).toBe(true);
    expect(Object.is(parseMoney("(0.00)"), 0)).toBe(true);
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(parseMoney("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMoney("-90071992547409.91")).toBe(-Number.MAX_SAFE_INTEGER);
    expect(parseMoney("90071992547409.92")).toBeNull();
    expect(parseMoney("1000000000000000000")).toBeNull();
  });
});

describe("formatCurrency", () => {
  it("formats CAD in en-CA and fr-CA", () => {
    expect(formatCurrency(2482042)).toBe("$24,820.42");
    expect(formatCurrency(-2482042)).toBe("-$24,820.42");
    expect(plain(formatCurrency(2482042, { locale: "fr-CA" }))).toBe("24 820,42 $");
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(-1)).toBe("-$0.01");
    expect(formatCurrency(5)).toBe("$0.05");
  });

  it("formats exactly at the edge of the safe integer range", () => {
    expect(formatCurrency(Number.MAX_SAFE_INTEGER)).toBe("$90,071,992,547,409.91");
  });

  it("shows a sign only for non-zero values when signed", () => {
    expect(formatCurrency(1234, { signed: true })).toBe("+$12.34");
    expect(formatCurrency(-1234, { signed: true })).toBe("-$12.34");
    expect(formatCurrency(0, { signed: true })).toBe("$0.00");
  });

  it("hides zero cents only when the amount is whole", () => {
    expect(formatCurrency(150000, { hideZeroCents: true })).toBe("$1,500");
    expect(formatCurrency(-150000, { hideZeroCents: true })).toBe("-$1,500");
    expect(formatCurrency(150001, { hideZeroCents: true })).toBe("$1,500.01");
  });

  it("rounds whole dollars half away from zero", () => {
    expect(formatCurrency(150050, { wholeDollars: true })).toBe("$1,501");
    expect(formatCurrency(150049, { wholeDollars: true })).toBe("$1,500");
    expect(formatCurrency(-150050, { wholeDollars: true })).toBe("-$1,501");
  });

  it("supports compact notation and other currencies", () => {
    expect(formatCurrency(2482042, { compact: true })).toBe("$24.8K");
    expect(formatCurrency(1234, { currency: "USD" })).toBe("US$12.34");
    expect(formatCurrency(1234, { currency: "EUR" })).toBe("€12.34");
  });
});

describe("centsToDecimalString", () => {
  it("renders exact decimal strings", () => {
    expect(centsToDecimalString(-123456)).toBe("-1234.56");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(-5)).toBe("-0.05");
    expect(centsToDecimalString(0)).toBe("0.00");
  });

  it("throws on non-integer cents", () => {
    expect(() => centsToDecimalString(1.5)).toThrow(RangeError);
  });
});

describe("mulDiv / percentOf / ratioBps", () => {
  it("rounds half away from zero", () => {
    expect(mulDiv(5, 1, 2)).toBe(3);
    expect(mulDiv(-5, 1, 2)).toBe(-3);
    expect(mulDiv(7, 1, 2)).toBe(4);
    expect(mulDiv(-7, 1, 2)).toBe(-4);
    expect(mulDiv(1, 1, 3)).toBe(0);
    expect(mulDiv(2, 1, 3)).toBe(1);
    expect(mulDiv(5, 1, -2)).toBe(-3);
  });

  it("is exact for products beyond 2^53", () => {
    // 9e15 * 3 overflows float precision but the BigInt path is exact.
    expect(mulDiv(9_000_000_000_000_000 / 1000, 3000, 3000)).toBe(9_000_000_000_000);
    expect(mulDiv(Number.MAX_SAFE_INTEGER, 10_000, 10_000)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects division by zero and non-integers", () => {
    expect(() => mulDiv(1, 1, 0)).toThrow(RangeError);
    expect(() => mulDiv(1.5, 1, 1)).toThrow(RangeError);
  });

  it("computes basis-point percentages", () => {
    expect(percentOf(150000, 1500)).toBe(22500);
    expect(percentOf(1, 5000)).toBe(1);
    expect(percentOf(-1, 5000)).toBe(-1);
    expect(percentOf(0, 2500)).toBe(0);
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(2, 3)).toBe(6667);
    expect(ratioBps(-1, 4)).toBe(-2500);
    expect(ratioBps(150, 100)).toBe(15000);
  });

  it("returns 0 for a ratio against zero", () => {
    expect(ratioBps(5, 0)).toBe(0);
    expect(ratioBps(0, 0)).toBe(0);
  });
});

describe("formatBps", () => {
  it("formats percentages with integer rounding", () => {
    expect(formatBps(3270)).toBe("32.7%");
    expect(formatBps(3275)).toBe("32.8%");
    expect(formatBps(3270, 0)).toBe("33%");
    expect(formatBps(3270, 2)).toBe("32.70%");
    expect(formatBps(0)).toBe("0.0%");
    expect(formatBps(-5)).toBe("-0.1%");
    expect(formatBps(-1250, 0)).toBe("-13%");
    expect(plain(formatBps(3270, 1, "fr-CA"))).toBe("32,7 %");
  });

  it("does not print a negative zero for tiny negative ratios", () => {
    expect(formatBps(-4)).toBe("0.0%");
    expect(formatBps(-49, 0)).toBe("0%");
  });
});

describe("allocateByWeights", () => {
  it("always sums exactly to the total", () => {
    const cases: [number, number[]][] = [
      [100, [1, 1, 1]],
      [-100, [1, 1, 1]],
      [1, [1, 1, 1]],
      [10, [3, 7]],
      [999_999, [17, 23, 5, 55]],
      [-1, [1, 1]],
      [12_345, [1, 0, 2]],
    ];
    for (const [total, weights] of cases) {
      const parts = allocateByWeights(total, weights);
      expect(parts.reduce((a, b) => a + b, 0), `${total} by ${weights}`).toBe(total);
      expect(parts).toHaveLength(weights.length);
    }
  });

  it("gives the leftover cents to the largest remainders, ties to the first", () => {
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeights(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocateByWeights(10, [3, 7])).toEqual([3, 7]);
    expect(allocateByWeights(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocateByWeights(12_345, [1, 0, 2])).toEqual([4115, 0, 8230]);
  });

  it("returns zeros when there is nothing to weigh", () => {
    expect(allocateByWeights(100, [0, 0])).toEqual([0, 0]);
    expect(allocateByWeights(100, [])).toEqual([]);
    expect(allocateByWeights(0, [1, 2])).toEqual([0, 0]);
  });
});

describe("toCents / sumCents", () => {
  it("converts database BigInts and nullish values", () => {
    expect(toCents(123n)).toBe(123);
    expect(toCents(-5n)).toBe(-5);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCentsOrNull(null)).toBeNull();
    expect(toCentsOrNull(7n)).toBe(7);
  });

  it("refuses values that cannot be represented exactly", () => {
    expect(() => toCents(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
    expect(() => toCents(0.5)).toThrow(RangeError);
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
    expect(() => sumCents([1, 0.1])).toThrow(RangeError);
  });

  it("sums integer cents", () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([10, -3, 5])).toBe(12);
    expect(sumCents(new Set([1, 2, 3]))).toBe(6);
  });
});
