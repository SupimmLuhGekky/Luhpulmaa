import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import { generateToken, hashToken } from "@/lib/security/tokens";
import { requestMeta } from "@/lib/security/request";
import { SESSION_COOKIE, SESSION_REFRESH_MS, SESSION_TTL_DAYS } from "./constants";

/**
 * Database-backed sessions.
 *
 * - The cookie holds a random 256-bit token; the database stores only its SHA-256 hash.
 * - Cookies are httpOnly, SameSite=Lax, Secure in production, and scoped to "/".
 * - Sessions slide forward on use and can be listed/revoked by the user.
 * - Changing the password revokes every other session.
 */
function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

export async function createSession(userId: string): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const meta = await requestMeta();
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
  });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  currency: string;
  locale: string;
  timeZone: string;
  country: string;
  province: string | null;
  emailVerifiedAt: Date | null;
  onboardingCompletedAt: Date | null;
  isDemo: boolean;
  sessionId: string;
}

/**
 * Validates the session cookie and returns the user, or null. Memoised per request.
 * Expired sessions are deleted on sight.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          currency: true,
          locale: true,
          timeZone: true,
          country: true,
          province: true,
          emailVerifiedAt: true,
          onboardingCompletedAt: true,
          isDemo: true,
        },
      },
    },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (now - session.lastUsedAt.getTime() > SESSION_REFRESH_MS) {
    const expiresAt = new Date(now + SESSION_TTL_DAYS * 86_400_000);
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now), expiresAt } }).catch(() => undefined);
    // Cookies can only be written in actions/route handlers; ignore when rendering.
    try {
      (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
    } catch {
      /* read-only context */
    }
  }
  return { ...session.user, sessionId: session.id };
});

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const { count } = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
  return count > 0;
}

export async function revokeOtherSessions(userId: string, keepSessionId: string | null): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
  });
  return count;
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, lastUsedAt: true, ipAddress: true, userAgent: true, expiresAt: true },
    orderBy: { lastUsedAt: "desc" },
  });
}
