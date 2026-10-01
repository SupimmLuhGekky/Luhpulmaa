import { apiRoute } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { rateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { askAssistant, assistantRequestSchema } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";
// A question can need several model round-trips with tool lookups.
export const maxDuration = 120;

/** Short-term cap on top of the hourly limit, so a stuck client can't burn through it. */
const BURST = { limit: 4, windowMs: 60_000 };

/**
 * POST /api/assistant — `{ question, history? }` → explanation plus facts computed from the
 * user's own data. Read-only: the assistant has no way to move money or change anything.
 */
export const POST = apiRoute({ body: assistantRequestSchema, rateLimit: RATE_LIMITS.assistant, rateLimitKey: "assistant" }, async ({ user, body }) => {
  const burst = await rateLimit(`assistant-burst:${user.id}`, BURST);
  if (!burst.allowed) throw new AppError("RATE_LIMITED", "You're asking a little fast. Please wait a few seconds.", { retryAfterSeconds: burst.retryAfterSeconds });
  return askAssistant(user.id, body);
});
