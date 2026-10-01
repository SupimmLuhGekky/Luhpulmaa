import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { globalSearch } from "@/lib/search/service";

export const dynamic = "force-dynamic";

/** GET /api/search?q=… — searches only the signed-in user's own records. */
export const GET = apiRoute({ query: z.object({ q: z.string().max(80).default("") }), rateLimitKey: "search" }, async ({ user, query }) => globalSearch(user.id, query.q));
