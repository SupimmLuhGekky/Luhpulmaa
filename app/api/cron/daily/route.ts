import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/config/env";
import { runDailyJobs } from "@/lib/jobs/daily";
import { safeEqual } from "@/lib/security/tokens";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily background jobs (bank sync, recurring detection, bill and budget alerts,
 * net-worth snapshots, scheduled automations). Called by Vercel Cron, a self-hosted
 * cron, or the Mac app, always with `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "CRON_SECRET is not set." } }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, secret)) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not allowed." } }, { status: 401 });
  try {
    const result = await runDailyJobs();
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron] daily run failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: { code: "INTERNAL", message: "The daily run failed." } }, { status: 500 });
  }
}
