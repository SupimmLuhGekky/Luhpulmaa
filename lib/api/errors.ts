import { ZodError } from "zod";
import { ProviderError, type ProviderErrorCode } from "@/lib/banking/types";

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "FEATURE_DISABLED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_ERROR: 502,
  FEATURE_DISABLED: 404,
  INTERNAL: 500,
};

/**
 * An error whose message is safe to show to the user. Anything that is not an
 * AppError is treated as internal and replaced by a generic message.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message: string, opts: { fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = opts.fieldErrors;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function notFound(what = "Resource"): AppError {
  return new AppError("NOT_FOUND", `${what} not found.`);
}

/** Bank-provider errors carry messages written for the user ("Your bank needs you to sign in again…"). */
const PROVIDER_CODES: Record<ProviderErrorCode, ErrorCode> = {
  NOT_CONFIGURED: "FEATURE_DISABLED",
  LOGIN_REQUIRED: "PROVIDER_ERROR",
  INSTITUTION_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_REQUEST: "BAD_REQUEST",
  UNKNOWN: "PROVIDER_ERROR",
};

export interface SafeError {
  code: ErrorCode;
  message: string;
  status: number;
  fieldErrors?: Record<string, string[]>;
  retryAfterSeconds?: number;
}

/** Converts any thrown value into a user-safe error, logging internals server-side only. */
export function toSafeError(error: unknown): SafeError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status, fieldErrors: error.fieldErrors, retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof ProviderError) {
    const code = PROVIDER_CODES[error.code] ?? "PROVIDER_ERROR";
    return { code, message: error.message, status: STATUS[code] };
  }
  if (error instanceof ZodError) {
    const flat = error.flatten();
    const fieldErrors = Object.fromEntries(Object.entries(flat.fieldErrors).filter(([, v]) => v && v.length)) as Record<string, string[]>;
    const first = flat.formErrors[0] ?? Object.values(fieldErrors)[0]?.[0];
    return { code: "VALIDATION_FAILED", message: first ?? "Some fields are invalid.", status: 422, fieldErrors };
  }
  const prismaCode = (error as { code?: string } | null)?.code;
  if (prismaCode === "P2002") return { code: "CONFLICT", message: "That already exists.", status: 409 };
  if (prismaCode === "P2025") return { code: "NOT_FOUND", message: "Not found.", status: 404 };
  if (prismaCode === "P2003") return { code: "CONFLICT", message: "This item is still in use by other records.", status: 409 };
  if (prismaCode === "P1001" || prismaCode === "P1002") {
    console.error("[db] database unavailable");
    return { code: "INTERNAL", message: "We can't reach the database right now. Please try again in a moment.", status: 503 };
  }
  // Next.js control-flow errors (redirect/notFound) must propagate.
  const digest = (error as { digest?: string } | null)?.digest;
  if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND")) {
    throw error;
  }
  console.error("[error]", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
  return { code: "INTERNAL", message: "Something went wrong on our side. Please try again.", status: 500 };
}
