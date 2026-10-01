import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS, rateLimit, resetRateLimit, setRateLimitStore, type RateLimitStore } from "@/lib/security/rate-limit";

let n = 0;
const key = (label: string) => `test:${label}:${++n}`;

describe("rateLimit (in-memory fixed window)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    vi.stubEnv("DISABLE_RATE_LIMIT", "false");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("allows up to the limit, then blocks with a retry delay", async () => {
    const k = key("signin");
    const rule = { limit: 3, windowMs: 60_000 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(k, rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[0].retryAfterSeconds).toBe(0);
    expect(results[3].retryAfterSeconds).toBe(60);
  });

  it("counts down the retry delay and opens a new window when it expires", async () => {
    const k = key("window");
    const rule = { limit: 1, windowMs: 60_000 };
    expect((await rateLimit(k, rule)).allowed).toBe(true);
    vi.advanceTimersByTime(45_500);
    expect(await rateLimit(k, rule)).toMatchObject({ allowed: false, retryAfterSeconds: 15 });
    vi.advanceTimersByTime(14_500);
    expect(await rateLimit(k, rule)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("keeps keys independent and can be reset", async () => {
    const a = key("a");
    const b = key("b");
    const rule = { limit: 1, windowMs: 60_000 };
    await rateLimit(a, rule);
    expect((await rateLimit(a, rule)).allowed).toBe(false);
    expect((await rateLimit(b, rule)).allowed).toBe(true);
    await resetRateLimit(a);
    expect((await rateLimit(a, rule)).allowed).toBe(true);
  });

  it("blocks everything with a zero limit", async () => {
    expect(await rateLimit(key("zero"), { limit: 0, windowMs: 1000 })).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("can be disabled outside production only", async () => {
    vi.stubEnv("DISABLE_RATE_LIMIT", "true");
    const k = key("disabled");
    for (let i = 0; i < 5; i++) expect((await rateLimit(k, { limit: 1, windowMs: 60_000 })).allowed).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    const p = key("prod");
    await rateLimit(p, { limit: 1, windowMs: 60_000 });
    expect((await rateLimit(p, { limit: 1, windowMs: 60_000 })).allowed).toBe(false);
  });

  it("uses a custom store when one is configured", async () => {
    const calls: string[] = [];
    const custom: RateLimitStore = {
      hit: async (k) => {
        calls.push(k);
        return { count: 99, resetAt: Date.now() + 5_000 };
      },
      reset: async () => {},
    };
    const original = (globalThis as { __rateLimitStore?: RateLimitStore }).__rateLimitStore!;
    setRateLimitStore(custom);
    try {
      expect(await rateLimit("custom-key", { limit: 10, windowMs: 60_000 })).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 5 });
      expect(calls).toEqual(["custom-key"]);
    } finally {
      setRateLimitStore(original);
    }
    // The default in-memory store is back.
    expect((await rateLimit(key("restored"), { limit: 1, windowMs: 60_000 })).allowed).toBe(true);
  });

  it("defines sane limits for sensitive endpoints", () => {
    expect(RATE_LIMITS.signIn).toEqual({ limit: 10, windowMs: 15 * 60_000 });
    expect(RATE_LIMITS.signUp.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.passwordReset.limit).toBeLessThanOrEqual(10);
  });
});
