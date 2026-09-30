import "server-only";
import type { VerificationTokenType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { appUrl, sendEmail } from "@/lib/email";
import { provisionDefaultCategories } from "@/lib/categories/provision";
import { provisionNotificationPreferences } from "@/lib/notifications/preferences";
import { rateLimit, RATE_LIMITS, resetRateLimit } from "@/lib/security/rate-limit";
import { requestMeta } from "@/lib/security/request";
import { generateToken, hashToken } from "@/lib/security/tokens";
import { EMAIL_VERIFICATION_TTL_MS, LOCKOUT_MS, MAX_FAILED_LOGINS, PASSWORD_RESET_TTL_MS } from "./constants";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { createSession, revokeOtherSessions } from "./session";

async function limitOrThrow(key: string, rule: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS]) {
  const result = await rateLimit(key, rule);
  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

async function issueToken(userId: string, type: VerificationTokenType, ttlMs: number): Promise<string> {
  const token = generateToken();
  await prisma.$transaction([
    // Only the newest token of a type is valid.
    prisma.verificationToken.deleteMany({ where: { userId, type, usedAt: null } }),
    prisma.verificationToken.create({ data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) } }),
  ]);
  return token;
}

async function consumeToken(token: string, type: VerificationTokenType) {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("BAD_REQUEST", type === "PASSWORD_RESET" ? "This reset link is invalid or has expired." : "This verification link is invalid or has expired.");
  }
  const { count } = await prisma.verificationToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count === 0) throw new AppError("BAD_REQUEST", "This link has already been used.");
  return record;
}

export async function sendVerificationEmail(userId: string, email: string, firstName: string) {
  const token = await issueToken(userId, "EMAIL_VERIFICATION", EMAIL_VERIFICATION_TTL_MS);
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: email,
    subject: "Confirm your email for Harbour",
    text: `Hi ${firstName},\n\nConfirm your email address to finish setting up Harbour:\n${link}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
  });
}

export async function signUp(input: { firstName: string; lastName: string; email: string; password: string }) {
  const meta = await requestMeta();
  await limitOrThrow(`signup:${meta.ipAddress ?? "unknown"}`, RATE_LIMITS.signUp);

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    // Same message shape as success would leak nothing, but a clear error is friendlier for sign-up.
    throw new AppError("CONFLICT", "An account with this email already exists. Try signing in instead.");
  }
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: input.email, firstName: input.firstName, lastName: input.lastName, passwordHash, passwordChangedAt: new Date() },
    });
    await provisionDefaultCategories(tx, created.id);
    await provisionNotificationPreferences(tx, created.id);
    return created;
  });
  await createSession(user.id);
  await audit(user.id, "auth.sign_up", { type: "user", id: user.id });
  await sendVerificationEmail(user.id, user.email, user.firstName);
  return { userId: user.id };
}

export async function signIn(input: { email: string; password: string }) {
  const meta = await requestMeta();
  const ipKey = `signin:ip:${meta.ipAddress ?? "unknown"}`;
  const emailKey = `signin:email:${input.email}`;
  await limitOrThrow(ipKey, { ...RATE_LIMITS.signIn, limit: RATE_LIMITS.signIn.limit * 3 });
  await limitOrThrow(emailKey, RATE_LIMITS.signIn);

  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const invalid = new AppError("UNAUTHORIZED", "The email or password is incorrect.");
  if (!user) {
    await verifyAgainstDummy(input.password);
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("RATE_LIMITED", "This account is temporarily locked after too many failed attempts. Try again later or reset your password.");
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null },
    });
    await audit(user.id, "auth.sign_in_failed", { type: "user", id: user.id }, { failedAttempts: failed });
    throw invalid;
  }
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }
  await resetRateLimit(emailKey);
  await createSession(user.id);
  await audit(user.id, "auth.sign_in", { type: "user", id: user.id });
  return { userId: user.id, onboarded: Boolean(user.onboardingCompletedAt) };
}

/** Always resolves the same way whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(email: string) {
  const meta = await requestMeta();
  await limitOrThrow(`reset:ip:${meta.ipAddress ?? "unknown"}`, RATE_LIMITS.passwordReset);
  await limitOrThrow(`reset:email:${email}`, RATE_LIMITS.passwordReset);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, firstName: true, email: true, isDemo: true } });
  if (!user || user.isDemo) return;
  const token = await issueToken(user.id, "PASSWORD_RESET", PASSWORD_RESET_TTL_MS);
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: user.email,
    subject: "Reset your Harbour password",
    text: `Hi ${user.firstName},\n\nUse this link to choose a new password:\n${link}\n\nThe link expires in 1 hour. If you didn't ask for this, you can ignore this email — your password won't change.`,
  });
  await audit(user.id, "auth.password_reset_requested", { type: "user", id: user.id });
}

export async function resetPassword(token: string, password: string) {
  const record = await consumeToken(token, "PASSWORD_RESET");
  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  // A reset signs out every device.
  await revokeOtherSessions(record.userId, null);
  await audit(record.userId, "auth.password_reset", { type: "user", id: record.userId });
}

export async function verifyEmail(token: string) {
  const meta = await requestMeta();
  await limitOrThrow(`verify:${meta.ipAddress ?? "unknown"}`, RATE_LIMITS.verifyEmail);
  const record = await consumeToken(token, "EMAIL_VERIFICATION");
  await prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  await audit(record.userId, "auth.email_verified", { type: "user", id: record.userId });
}

export async function resendVerification(userId: string) {
  await limitOrThrow(`verify-resend:${userId}`, RATE_LIMITS.verifyEmail);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, firstName: true, emailVerifiedAt: true } });
  if (user.emailVerifiedAt) return;
  await sendVerificationEmail(userId, user.email, user.firstName);
}

export async function changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.isDemo) throw new AppError("FORBIDDEN", "The demo account's password can't be changed.");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError("VALIDATION_FAILED", "Your current password is incorrect.", { fieldErrors: { currentPassword: ["Incorrect password"] } });
  }
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } });
  const revoked = await revokeOtherSessions(userId, sessionId);
  await audit(userId, "auth.password_changed", { type: "user", id: userId }, { otherSessionsRevoked: revoked });
}
