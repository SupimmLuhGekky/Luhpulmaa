import "server-only";
import type { z } from "zod";
import { requireApiUser } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
import { toSafeError, type SafeError } from "./errors";

/** Discriminated result returned by every server action to the client. */
export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: Omit<SafeError, "status"> };

/**
 * Wraps a server action: authenticates the caller, validates input with zod and
 * converts errors into safe messages. Next.js server actions are POST-only and
 * verify the Origin header, which provides CSRF protection.
 */
export function authedAction<S extends z.ZodTypeAny, T>(
  schema: S,
  handler: (input: z.infer<S>, user: SessionUser) => Promise<T>,
): (input: z.input<S>) => Promise<ActionResult<T>> {
  return async (raw) => {
    try {
      const user = await requireApiUser();
      const input = schema.parse(raw);
      const data = await handler(input, user);
      return { ok: true, data };
    } catch (error) {
      const { status: _status, ...safe } = toSafeError(error);
      return { ok: false, error: safe };
    }
  };
}

/** Same as authedAction for actions that need no authentication (sign-in, sign-up…). */
export function publicAction<S extends z.ZodTypeAny, T>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<T>,
): (input: z.input<S>) => Promise<ActionResult<T>> {
  return async (raw) => {
    try {
      const input = schema.parse(raw);
      const data = await handler(input);
      return { ok: true, data };
    } catch (error) {
      const { status: _status, ...safe } = toSafeError(error);
      return { ok: false, error: safe };
    }
  };
}
