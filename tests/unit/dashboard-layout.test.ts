import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGETS, DEFAULT_LAYOUT, defaultLayoutFor, resolveLayout } from "@/lib/dashboard/layout";

const ids = (layout: { widgets: { id: string }[] }) => layout.widgets.map((w) => w.id);

describe("defaultLayoutFor", () => {
  it("keeps the standard order when no goals were chosen", () => {
    expect(defaultLayoutFor([])).toEqual(DEFAULT_LAYOUT);
  });

  it("puts safe to spend first, then the cards for the chosen goals, then the rest", () => {
    const layout = defaultLayoutFor(["bills", "save"]);
    // Goals follow the onboarding list's order, whatever order they were picked in.
    expect(ids(layout).slice(0, 4)).toEqual(["safeToSpend", "goals", "bills", "subscriptions"]);
    expect(ids(layout).slice(4)).toEqual(ids(DEFAULT_LAYOUT).filter((id) => !["safeToSpend", "goals", "bills", "subscriptions"].includes(id)));
  });

  it("lists every card once and shows them all", () => {
    const layout = defaultLayoutFor(["track_spending", "budget", "save", "debt", "bills", "cash_flow", "net_worth"]);
    expect([...ids(layout)].sort()).toEqual(DASHBOARD_WIDGETS.map((w) => w.id).sort());
    expect(layout.widgets.every((w) => w.visible)).toBe(true);
    expect(resolveLayout(layout)).toEqual(layout);
  });
});
