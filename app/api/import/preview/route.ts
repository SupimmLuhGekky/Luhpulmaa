import { apiRoute } from "@/lib/api/route";
import { previewImport } from "@/lib/import/service";
import { importPayloadSchema } from "@/lib/import/normalize";

/** POST /api/import/preview  (same body as /api/import)  → counts and the first rows with new/duplicate/skipped/error status; saves nothing */
export const POST = apiRoute({ body: importPayloadSchema }, async ({ user, body }) => previewImport(user.id, body));
