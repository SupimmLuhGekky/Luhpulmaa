/**
 * Fixed-window rate limiter.
 *
 * The default store is in-memory, which is correct for a single Node process (local
 * development, a single container). On serverless/multi-instance deployments plug in a
 * shared store (Redis/Upstash) by implementing `RateLimitStore` and calling
 * `setRateLimitStore()` at startup.
 */
export interface RateLimitStore {
  /** Increments the counter for `key` and returns the new count and window reset time. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  reset(key: string): Promise<void>;
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      if (this.buckets.size > 10_000) this.sweep(now);
      return fresh;
    }
    bucket.count += 1;
    return bucket;
  }

  async reset(key: string) {
    this.buckets.delete(key);
  }

  private sweep(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

const globalStore = globalThis as unknown as { __rateLimitStore?: RateLimitStore };
let store: RateLimitStore = globalStore.__rateLimitStore ?? (globalStore.__rateLimitStore = new MemoryStore());

export function setRateLimitStore(custom: RateLimitStore) {
  store = custom;
}

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  signIn: { limit: 10, windowMs: 15 * 60_000 },
  signUp: { limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  verifyEmail: { limit: 10, windowMs: 60 * 60_000 },
  sync: { limit: 20, windowMs: 60 * 60_000 },
  export: { limit: 30, windowMs: 60 * 60_000 },
  import: { limit: 30, windowMs: 60 * 60_000 },
  assistant: { limit: 30, windowMs: 60 * 60_000 },
  api: { limit: 300, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function rateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  if (process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production") {
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }
  const { count, resetAt } = await store.hit(key, rule.windowMs);
  const allowed = count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

export async function resetRateLimit(key: string) {
  await store.reset(key);
}
