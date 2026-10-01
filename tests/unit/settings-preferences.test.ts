import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, parsePreferences, preferencesPatchSchema } from "@/lib/settings/preferences";
import { timeZoneLabel } from "@/lib/settings/options";
import { coarseIp, describeUserAgent } from "@/lib/users/devices";

describe("stored preferences", () => {
  it("fills in defaults for missing keys", () => {
    expect(parsePreferences({})).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences([1, 2])).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid keys when another one is invalid or outdated", () => {
    const prefs = parsePreferences({ budgetAlertThresholds: [50, 90], theme: "sepia", largeTransactionCents: -5, aiOptIn: true, unknownKey: 1 });
    expect(prefs.budgetAlertThresholds).toEqual([50, 90]);
    expect(prefs.aiOptIn).toBe(true);
    expect(prefs.theme).toBe("system");
    expect(prefs.largeTransactionCents).toBe(DEFAULT_PREFERENCES.largeTransactionCents);
    expect(prefs).not.toHaveProperty("unknownKey");
  });

  it("validates changes strictly", () => {
    expect(preferencesPatchSchema.safeParse({ budgetRolloverDefault: true }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ budgetAlertThresholds: [0] }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ appGoals: ["budget", "lottery"] }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ somethingElse: true }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ goalContributionKind: "BANK_VERIFIED_TRANSFER" }).success).toBe(false);
  });
});

describe("device descriptions", () => {
  it("summarises common browsers without the full user agent", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")).toEqual({
      label: "Chrome on macOS",
      browser: "Chrome",
      os: "macOS",
      kind: "desktop",
    });
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1").label).toBe("Safari on iPhone");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0").label).toBe("Edge on Windows");
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0").label).toBe("Firefox on Linux");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36").kind).toBe("mobile");
  });

  it("recognises the Mac app and unknown agents", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Harbour/1.0.0 Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36")).toMatchObject({ label: "Harbour for Mac", kind: "app" });
    expect(describeUserAgent(null)).toMatchObject({ label: "Unknown device", kind: "unknown" });
    expect(describeUserAgent("curl/8.5.0").label).toBe("Unknown browser");
  });

  it("hides the end of IP addresses", () => {
    expect(coarseIp("203.0.113.42")).toBe("203.0.113.x");
    expect(coarseIp("::ffff:198.51.100.7")).toBe("198.51.100.x");
    expect(coarseIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::/48");
    expect(coarseIp("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(coarseIp("127.0.0.1")).toBe("This computer");
    expect(coarseIp(null)).toBe("Unknown network");
    expect(coarseIp("not an ip")).toBe("Unknown network");
  });
});

describe("time zone labels", () => {
  it("uses friendly names with a fallback", () => {
    expect(timeZoneLabel("America/Toronto")).toBe("Toronto (Eastern)");
    expect(timeZoneLabel("Asia/Ho_Chi_Minh")).toBe("Asia/Ho Chi Minh");
  });
});
