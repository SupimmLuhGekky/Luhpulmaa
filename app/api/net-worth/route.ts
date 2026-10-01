import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { NET_WORTH_RANGES } from "@/lib/networth/contributions";
import { netWorthOverview } from "@/lib/networth/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/net-worth?range=1m|3m|6m|ytd|1y|all
 * Current net worth summary, daily history for the range (ending with today's live
 * figures), the change over the range and each account's contribution.
 */
export const GET = apiRoute({ query: z.object({ range: z.enum(NET_WORTH_RANGES).default("6m") }), rateLimitKey: "net-worth" }, async ({ user, query }) => netWorthOverview(user.id, query.range));
