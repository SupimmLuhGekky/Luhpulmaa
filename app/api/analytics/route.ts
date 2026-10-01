import { apiRoute } from "@/lib/api/route";
import { analytics, analyticsQuerySchema } from "@/lib/analytics/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics?range=week|month|quarter|year|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *   [&accounts=<id>,<id>][&categories=<id>,<id>]
 * Spending, income, breakdowns, changes vs the previous period and factual insights
 * for the signed-in user's own transactions.
 */
export const GET = apiRoute({ query: analyticsQuerySchema, rateLimitKey: "analytics" }, async ({ user, query }) => analytics(user.id, query));
