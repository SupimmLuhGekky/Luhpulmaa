import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { env } from "@/lib/config/env";
import { requireApiUser } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
import { rateLimit, RATE_LIMITS, type RateLimitRule } from "@/lib/security/rate-limit";
import { AppError, toSafeError } from "./errors";

/**
 * Consistent JSON envelope for every API route:
 *   success → { data: T, meta?: {...} }
 *   failure → { error: { code, message, fieldErrors? } }
 */
export function json<T>(data: T, init: { status?: number; meta?: Record<string, unknown> } = {}) {
  return NextResponse.json(serialize({ data, ...(init.meta ? { meta: init.meta } : {}) }), { status: init.status ?? 200 });
}

export function errorResponse(error: unknown) {
  const safe = toSafeError(error);
  const headers: Record<string, string> = {};
  if (safe.retryAfterSeconds) headers["Retry-After"] = String(safe.retryAfterSeconds);
  return NextResponse.json(
    { error: { code: safe.code, message: safe.message, ...(safe.fieldErrors ? { fieldErrors: safe.fieldErrors } : {}) } },
    { status: safe.status, headers },
  );
}

/** BigInt → string and Date → ISO so responses are always valid JSON. */
export function serialize<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence for cookie-authenticated JSON APIs: mutating requests must come from
 * our own origin (Origin header, falling back to Referer). SameSite=Lax cookies are
 * the first line of defence; this is the second.
 */
function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) throw new AppError("FORBIDDEN", "Missing request origin.");
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Invalid request origin.");
  }
  const allowed = new Set([req.nextUrl.host, new URL(env().APP_URL).host]);
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) allowed.add(forwardedHost);
  if (!allowed.has(host)) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
}

type Ctx<P> = { params: Promise<P> };

interface HandlerArgs<P, B, Q> {
  req: NextRequest;
  user: SessionUser;
  params: P;
  body: B;
  query: Q;
}

/**
 * Authenticated API route with zod-validated body and query, origin checks,
 * per-user rate limiting and safe error handling.
 */
export function apiRoute<P = Record<string, string>, BS extends z.ZodTypeAny = z.ZodUndefined, QS extends z.ZodTypeAny = z.ZodUndefined>(
  opts: { body?: BS; query?: QS; rateLimit?: RateLimitRule; rateLimitKey?: string },
  handler: (args: HandlerArgs<P, z.infer<BS>, z.infer<QS>>) => Promise<Response | unknown>,
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      assertSameOrigin(req);
      const user = await requireApiUser();
      const rule = opts.rateLimit ?? RATE_LIMITS.api;
      const rl = await rateLimit(`${opts.rateLimitKey ?? "api"}:${user.id}`, rule);
      if (!rl.allowed) throw new AppError("RATE_LIMITED", "Too many requests. Please slow down.", { retryAfterSeconds: rl.retryAfterSeconds });

      let body: unknown = undefined;
      if (opts.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw new AppError("BAD_REQUEST", "Request body must be valid JSON.");
        }
        body = opts.body.parse(raw);
      }
      let query: unknown = undefined;
      if (opts.query) query = opts.query.parse(Object.fromEntries(req.nextUrl.searchParams));
      const params = (ctx?.params ? await ctx.params : {}) as P;
      const result = await handler({ req, user, params, body: body as z.infer<BS>, query: query as z.infer<QS> });
      if (result instanceof Response) return result;
      return json(result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
