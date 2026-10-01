import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { attachmentHeader, EXPORT_TYPES } from "@/lib/export/files";
import { exportFile, exportQuerySchema } from "@/lib/export/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/export?type=transactions|budget|goals|contributions|summary|accounts|all
 * Optional: from/to (transactions), month=YYYY-MM (budget). Only the signed-in user's data.
 */
export const GET = apiRoute({ query: exportQuerySchema.extend({ type: z.enum(EXPORT_TYPES) }), rateLimit: RATE_LIMITS.export, rateLimitKey: "export" }, async ({ user, query }) => {
  const { type, ...q } = query;
  const file = await exportFile(user.id, type, q);
  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": attachmentHeader(file.filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
