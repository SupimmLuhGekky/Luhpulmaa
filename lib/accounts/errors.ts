import { AppError, type ErrorCode } from "@/lib/api/errors";
import { ProviderError, type ProviderErrorCode } from "@/lib/banking/types";

/**
 * Banking adapters throw `ProviderError`s whose messages are already user-safe
 * ("Your bank needs you to sign in again…"). The shared error handler only trusts
 * `AppError`, so account actions and routes translate them first; otherwise the
 * person would see a generic "something went wrong" instead of what to do next.
 */
const CODES: Record<ProviderErrorCode, ErrorCode> = {
  NOT_CONFIGURED: "FEATURE_DISABLED",
  LOGIN_REQUIRED: "PROVIDER_ERROR",
  INSTITUTION_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_REQUEST: "BAD_REQUEST",
  UNKNOWN: "PROVIDER_ERROR",
};

export function toAccountsError(error: unknown): unknown {
  if (error instanceof ProviderError) return new AppError(CODES[error.code] ?? "PROVIDER_ERROR", error.message);
  return error;
}

/** Runs a service call, converting provider errors into safe AppErrors. */
export async function withProviderErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toAccountsError(error);
  }
}

/** Friendly copy for the bank-sync rate limit. */
export function syncRateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You've refreshed your banks a lot in the last hour. Please try again in ${minutes === 1 ? "a minute" : `about ${minutes} minutes`}.`;
}
