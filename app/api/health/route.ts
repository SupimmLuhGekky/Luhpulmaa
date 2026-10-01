import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

/** Liveness and database check, used by uptime monitors and the desktop app's startup probe. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
