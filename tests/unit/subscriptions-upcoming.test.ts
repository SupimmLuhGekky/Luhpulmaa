import { describe, expect, it } from "vitest";
import { upcomingCharges } from "@/lib/subscriptions/upcoming";

const base = { amountCents: 1_000, status: "ACTIVE" };

describe("upcomingCharges", () => {
  it("repeats each active subscription inside the window, in date order", () => {
    const list = upcomingCharges(
      [
        { ...base, id: "a", name: "Netflix", frequency: "MONTHLY", nextChargeDate: "2026-10-08", amountCents: 2_299 },
        { ...base, id: "b", name: "Coffee club", frequency: "WEEKLY", nextChargeDate: "2026-10-02" },
        { ...base, id: "c", name: "Annual app", frequency: "YEARLY", nextChargeDate: "2027-03-01" },
      ],
      "2026-09-30",
      30,
    );
    expect(list.map((c) => [c.name, c.date])).toEqual([
      ["Coffee club", "2026-10-02"],
      ["Netflix", "2026-10-08"],
      ["Coffee club", "2026-10-09"],
      ["Coffee club", "2026-10-16"],
      ["Coffee club", "2026-10-23"],
    ]);
    expect(list.reduce((s, c) => s + c.amountCents, 0)).toBe(2_299 + 4 * 1_000);
  });

  it("includes both ends of the window", () => {
    const list = upcomingCharges([{ ...base, id: "a", name: "A", frequency: "MONTHLY", nextChargeDate: "2026-09-30" }], "2026-09-30", 31);
    expect(list.map((c) => c.date)).toEqual(["2026-09-30", "2026-10-30"]);
  });

  it("skips paused, cancelled and undated subscriptions", () => {
    const list = upcomingCharges(
      [
        { ...base, id: "a", name: "Paused", frequency: "MONTHLY", nextChargeDate: "2026-10-05", status: "PAUSED" },
        { ...base, id: "b", name: "Cancelled", frequency: "MONTHLY", nextChargeDate: "2026-10-05", status: "CANCELLED" },
        { ...base, id: "c", name: "No date", frequency: "MONTHLY", nextChargeDate: null },
      ],
      "2026-09-30",
    );
    expect(list).toEqual([]);
  });
});
