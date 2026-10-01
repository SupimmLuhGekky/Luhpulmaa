import "server-only";
import { AppError } from "@/lib/api/errors";
import { rateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { syncRateLimitMessage } from "./errors";

/**
 * Bank syncs and connections reach the provider (and the bank behind it), so actions
 * and API routes share one hourly budget per user (`sync:<userId>`). Link sessions get
 * their own bucket so opening and closing the sign-in window never blocks a later sync.
 */
export async function enforceSyncLimit(bucket: "sync" | "link", userId: string) {
  const rl = await rateLimit(`${bucket}:${userId}`, RATE_LIMITS.sync);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", syncRateLimitMessage(rl.retryAfterSeconds), { retryAfterSeconds: rl.retryAfterSeconds });
}
