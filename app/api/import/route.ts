import { apiRoute } from "@/lib/api/route";
import { commitImport } from "@/lib/import/service";
import { importPayloadSchema } from "@/lib/import/normalize";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

/** POST /api/import  { accountId, fileName?, hasHeader, mapping, rows: string[][] }  → imports new rows */
export const POST = apiRoute({ body: importPayloadSchema, rateLimit: RATE_LIMITS.import, rateLimitKey: "import" }, async ({ user, body }) => commitImport(user.id, body));
