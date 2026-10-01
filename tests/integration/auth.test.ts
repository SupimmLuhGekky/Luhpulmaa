import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { changePassword, requestPasswordReset, resetPassword, signIn, signUp, verifyEmail } from "@/lib/auth/service";
import { createSession, destroyCurrentSession, getSessionUser, listSessions, revokeOtherSessions, revokeSession } from "@/lib/auth/session";
import { hashToken } from "@/lib/security/tokens";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { createUser, TEST_PASSWORD, uniqueEmail } from "./helpers/factory";
import { requestContext } from "./helpers/next-headers";

const NEW_PASSWORD = "fictional-new-pass-2";
let emails: string[] = [];
let infoSpy: MockInstance<typeof console.info>;

/** The console email adapter prints each message; pull the token out of the last link. */
function lastEmailToken(kind: "verify-email" | "reset-password") {
  const body = [...emails].reverse().find((e) => e.includes(`/${kind}?token=`));
  const match = body?.match(new RegExp(`/${kind}\\?token=([^\\s]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

beforeEach(() => {
  requestContext.reset();
  emails = [];
  infoSpy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    emails.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  infoSpy.mockRestore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("sign up", () => {
  it("creates the user with default categories, a hashed session cookie and a verification email", async () => {
    const email = uniqueEmail("signup");
    const { userId } = await signUp({ firstName: "Camille", lastName: "Fictional", email, password: "fictional-pass-123" });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ email, firstName: "Camille", emailVerifiedAt: null, onboardingCompletedAt: null, currency: "CAD", timeZone: "America/Toronto" });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordHash).not.toContain("fictional-pass-123");
    expect(await prisma.category.count({ where: { userId } })).toBe(DEFAULT_CATEGORIES.length);
    expect(await prisma.notificationPreference.count({ where: { userId } })).toBeGreaterThan(0);

    const cookie = requestContext.cookie(SESSION_COOKIE)!;
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    expect(session.tokenHash).toBe(hashToken(cookie.value));
    expect(session).toMatchObject({ ipAddress: "203.0.113.10", userAgent: "HarbourIntegrationTest/1.0" });
    expect(Math.round((session.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect(cookie.options.expires?.getTime()).toBe(session.expiresAt.getTime());

    expect(lastEmailToken("verify-email")).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { userId, action: "auth.sign_up" } })).toBe(1);
  });

  it("rejects a second account with the same email", async () => {
    const email = uniqueEmail("dupe");
    await signUp({ firstName: "A", lastName: "B", email, password: "fictional-pass-123" });
    await expect(signUp({ firstName: "C", lastName: "D", email, password: "fictional-pass-456" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("normalises the email at the action boundary so case variants cannot create a second account", async () => {
    const { signUpAction } = await import("@/app/actions/auth");
    const email = uniqueEmail("case");
    const first = await signUpAction({ firstName: "Léa", lastName: "Fictional", email: email.toUpperCase(), password: "fictional-pass-123" });
    expect(first.ok).toBe(true);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    const second = await signUpAction({ firstName: "Léa", lastName: "Fictional", email: `  ${email} `, password: "fictional-pass-123" });
    expect(second).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const weak = await signUpAction({ firstName: "Léa", lastName: "Fictional", email: uniqueEmail("weak"), password: "short" });
    expect(weak).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("verifies the email once with the emailed token", async () => {
    const { userId } = await signUp({ firstName: "Noah", lastName: "Fictional", email: uniqueEmail("verify"), password: "fictional-pass-123" });
    const token = lastEmailToken("verify-email")!;
    await verifyEmail(token);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).toBeInstanceOf(Date);
    await expect(verifyEmail(token)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(verifyEmail("not-a-real-token-but-long-enough")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an expired verification token", async () => {
    await signUp({ firstName: "Zoé", lastName: "Fictional", email: uniqueEmail("expired"), password: "fictional-pass-123" });
    const token = lastEmailToken("verify-email")!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 25 * 3_600_000);
    await expect(verifyEmail(token)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("sign in", () => {
  it("signs in with the right password and starts a new session", async () => {
    const user = await createUser({ onboarded: false });
    const result = await signIn({ email: user.email, password: TEST_PASSWORD });
    expect(result).toEqual({ userId: user.id, onboarded: false });
    const sessionUser = await getSessionUser();
    expect(sessionUser).toMatchObject({ id: user.id, email: user.email });
  });

  it("gives the same error for a wrong password and an unknown email, and counts failures", async () => {
    const user = await createUser();
    const wrong = await signIn({ email: user.email, password: "not-the-password-1" }).catch((e: unknown) => e);
    const unknown = await signIn({ email: uniqueEmail("nobody"), password: "not-the-password-1" }).catch((e: unknown) => e);
    expect(wrong).toMatchObject({ code: "UNAUTHORIZED" });
    expect(unknown).toMatchObject({ code: "UNAUTHORIZED", message: (wrong as Error).message });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(1);
    expect(requestContext.cookie(SESSION_COOKIE)).toBeUndefined();
  });

  it("locks the account after 8 failures, even for the right password, until the lockout ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T16:00:00Z"));
    const user = await createUser();
    for (let i = 0; i < 8; i++) await expect(signIn({ email: user.email, password: `wrong-password-${i}` })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(signIn({ email: user.email, password: TEST_PASSWORD })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    vi.setSystemTime(new Date("2026-10-01T16:16:00Z"));
    await expect(signIn({ email: user.email, password: TEST_PASSWORD })).resolves.toMatchObject({ userId: user.id });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it("rate-limits repeated attempts on one email", async () => {
    vi.stubEnv("DISABLE_RATE_LIMIT", "false");
    requestContext.reset("203.0.113.77");
    const email = uniqueEmail("limited");
    for (let i = 0; i < 10; i++) await expect(signIn({ email, password: "not-the-password-1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const blocked = await signIn({ email, password: "not-the-password-1" }).catch((e: unknown) => e);
    expect(blocked).toMatchObject({ code: "RATE_LIMITED" });
    expect((blocked as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rate-limits sign-ups per IP", async () => {
    vi.stubEnv("DISABLE_RATE_LIMIT", "false");
    requestContext.reset("203.0.113.88");
    for (let i = 0; i < 5; i++) await signUp({ firstName: "R", lastName: "L", email: uniqueEmail(`burst${i}`), password: "fictional-pass-123" });
    await expect(signUp({ firstName: "R", lastName: "L", email: uniqueEmail("burst6"), password: "fictional-pass-123" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("sessions", () => {
  it("returns null without a cookie or with an unknown token", async () => {
    expect(await getSessionUser()).toBeNull();
    requestContext.setCookie(SESSION_COOKIE, "unknown-token");
    expect(await getSessionUser()).toBeNull();
    requestContext.setCookie(SESSION_COOKIE, "x".repeat(500));
    expect(await getSessionUser()).toBeNull();
  });

  it("expires after 30 days and deletes the expired session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T16:00:00Z"));
    const user = await createUser();
    await createSession(user.id);
    vi.setSystemTime(new Date("2026-10-31T16:00:01Z"));
    expect(await getSessionUser()).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("slides the expiry forward when used after a day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T16:00:00Z"));
    const user = await createUser();
    await createSession(user.id);
    // Session.lastUsedAt defaults to the database clock; pin it to the frozen clock.
    await prisma.session.updateMany({ where: { userId: user.id }, data: { lastUsedAt: new Date() } });
    vi.setSystemTime(new Date("2026-10-20T16:00:00Z"));
    expect(await getSessionUser()).toMatchObject({ id: user.id });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.expiresAt.toISOString()).toBe("2026-11-19T16:00:00.000Z");
    expect(requestContext.cookie(SESSION_COOKIE)?.options.expires?.toISOString()).toBe("2026-11-19T16:00:00.000Z");
  });

  it("signs out by deleting the cookie and the session", async () => {
    const user = await createUser();
    await createSession(user.id);
    await destroyCurrentSession();
    expect(requestContext.cookie(SESSION_COOKIE)).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("lets a user revoke their own sessions but not someone else's", async () => {
    const alice = await createUser({ firstName: "Alice" });
    const bob = await createUser({ firstName: "Bob" });
    await createSession(alice.id);
    const aliceSession = await prisma.session.findFirstOrThrow({ where: { userId: alice.id } });
    expect(await revokeSession(bob.id, aliceSession.id)).toBe(false);
    expect(await getSessionUser()).toMatchObject({ id: alice.id });
    expect(await revokeSession(alice.id, aliceSession.id)).toBe(true);
    expect(await getSessionUser()).toBeNull();
  });

  it("revokes other sessions while keeping the current one", async () => {
    const user = await createUser();
    await createSession(user.id); // "phone"
    await createSession(user.id); // "laptop" (current cookie)
    const current = await getSessionUser();
    expect(await listSessions(user.id)).toHaveLength(2);
    expect(await revokeOtherSessions(user.id, current!.sessionId)).toBe(1);
    expect((await listSessions(user.id)).map((s) => s.id)).toEqual([current!.sessionId]);
  });
});

describe("password reset and change", () => {
  it("resets the password with a single-use emailed token and signs out every device", async () => {
    const user = await createUser();
    await createSession(user.id);
    await requestPasswordReset(user.email);
    const token = lastEmailToken("reset-password")!;
    expect(token).toBeTruthy();
    await resetPassword(token, NEW_PASSWORD);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    await expect(signIn({ email: user.email, password: TEST_PASSWORD })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(signIn({ email: user.email, password: NEW_PASSWORD })).resolves.toMatchObject({ userId: user.id });
    await expect(resetPassword(token, "another-pass-3")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("answers the same way for unknown emails and sends nothing", async () => {
    await expect(requestPasswordReset(uniqueEmail("ghost"))).resolves.toBeUndefined();
    expect(lastEmailToken("reset-password")).toBeNull();
  });

  it("invalidates older reset links when a new one is requested", async () => {
    const user = await createUser();
    await requestPasswordReset(user.email);
    const first = lastEmailToken("reset-password")!;
    await requestPasswordReset(user.email);
    const second = lastEmailToken("reset-password")!;
    expect(second).not.toBe(first);
    await expect(resetPassword(first, NEW_PASSWORD)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(resetPassword(second, NEW_PASSWORD)).resolves.toBeUndefined();
  });

  it("rate-limits reset requests per email", async () => {
    vi.stubEnv("DISABLE_RATE_LIMIT", "false");
    requestContext.reset("203.0.113.99");
    const user = await createUser();
    for (let i = 0; i < 5; i++) await requestPasswordReset(user.email);
    await expect(requestPasswordReset(user.email)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("changes the password only with the current one and keeps the current session", async () => {
    const user = await createUser();
    await createSession(user.id); // another device
    await createSession(user.id); // this device
    const current = (await getSessionUser())!;
    await expect(changePassword(user.id, current.sessionId, "wrong-current-1", NEW_PASSWORD)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await changePassword(user.id, current.sessionId, TEST_PASSWORD, NEW_PASSWORD);
    expect((await prisma.session.findMany({ where: { userId: user.id } })).map((s) => s.id)).toEqual([current.sessionId]);
    await expect(signIn({ email: user.email, password: NEW_PASSWORD })).resolves.toMatchObject({ userId: user.id });
  });
});
