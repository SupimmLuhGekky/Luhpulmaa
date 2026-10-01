import { describe, expect, it } from "vitest";
import { canonicalQuery, filtersFromSearchParams, txnFromSearchParams } from "@/lib/transactions/url";

const ID = "3f1c2a4e-8b7d-4c1a-9e2f-0a1b2c3d4e5f";

describe("transactions URL", () => {
  it("reads the short parameter names", () => {
    const f = filtersFromSearchParams({ category: "uncategorized", from: "2026-09-01", to: "2026-09-30", min: "10", max: "25.50" });
    expect(f.categoryId).toBe("uncategorized");
    expect(f.from).toBe("2026-09-01");
    expect(f.minCents).toBe(1000);
    expect(f.maxCents).toBe(2550);
  });

  it("accepts the longer spellings other links use", () => {
    expect(filtersFromSearchParams({ categoryId: ID }).categoryId).toBe(ID);
    expect(filtersFromSearchParams({ accountId: ID }).accountId).toBe(ID);
  });

  it("ignores a bad value without dropping the others", () => {
    const f = filtersFromSearchParams({ category: "not-a-uuid", from: "2026-09-01" });
    expect(f.categoryId).toBeUndefined();
    expect(f.from).toBe("2026-09-01");
  });

  it("rewrites older spellings to the page's own", () => {
    expect(canonicalQuery({ category: ID })).toBeNull();
    expect(canonicalQuery({ categoryId: ID, from: "2026-09-01" })).toBe(`category=${ID}&from=2026-09-01`);
    expect(canonicalQuery({ id: ID })).toBe(`txn=${ID}`);
    // The current spelling wins when both are present.
    expect(canonicalQuery({ category: "uncategorized", categoryId: ID })).toBe("category=uncategorized");
  });

  it("opens a transaction only for a valid id", () => {
    expect(txnFromSearchParams({ txn: ID })).toBe(ID);
    expect(txnFromSearchParams({ txn: "nope" })).toBeNull();
    expect(txnFromSearchParams({})).toBeNull();
  });
});
