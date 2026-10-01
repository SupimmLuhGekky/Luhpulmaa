import { apiRoute } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { isEnabled } from "@/lib/flags";
import { commitImport } from "@/lib/import/service";
import { importPayloadSchema } from "@/lib/import/normalize";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

/** POST /api/import  { accountId, fileName?, hasHeader, mapping, rows: string[][] }  → imports new rows */
export const POST = apiRoute({ body: importPayloadSchema, rateLimit: RATE_LIMITS.import, rateLimitKey: "import" }, async ({ user, body }) => {
  if (!isEnabled("ENABLE_CSV_IMPORT")) throw new AppError("FEATURE_DISABLED", "CSV import is turned off on this server.");
  return commitImport(user.id, body);
});
