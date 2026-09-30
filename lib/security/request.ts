import "server-only";
import { headers } from "next/headers";

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Client IP and user agent from the incoming request (behind Vercel/proxies, first x-forwarded-for hop). */
export async function requestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    const ua = h.get("user-agent");
    return { ipAddress: ip, userAgent: ua ? ua.slice(0, 300) : null };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}
