import { apiRoute } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { isEnabled } from "@/lib/flags";
import { previewImport } from "@/lib/import/service";
import { importPayloadSchema } from "@/lib/import/normalize";

/** POST /api/import/preview  (same body as /api/import)  → counts and the first rows with new/duplicate/skipped/error status; saves nothing */
export const POST = apiRoute({ body: importPayloadSchema }, async ({ user, body }) => {
  if (!isEnabled("ENABLE_CSV_IMPORT")) throw new AppError("FEATURE_DISABLED", "CSV import is turned off on this server.");
  return previewImport(user.id, body);
});
