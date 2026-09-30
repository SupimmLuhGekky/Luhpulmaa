"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authedAction, publicAction } from "@/lib/api/action";
import { AppError } from "@/lib/api/errors";
import { forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema } from "@/lib/auth/schemas";
import { requestPasswordReset, resendVerification, resetPassword, signIn, signUp, verifyEmail } from "@/lib/auth/service";
import { createSession, destroyCurrentSession, getSessionUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { ensureDemoUser } from "@/lib/demo";

export const signInAction = publicAction(signInSchema, async (input) => signIn(input));

export const signUpAction = publicAction(signUpSchema, async (input) => signUp(input));

export const forgotPasswordAction = publicAction(forgotPasswordSchema, async ({ email }) => {
  await requestPasswordReset(email);
  return { sent: true };
});

export const resetPasswordAction = publicAction(resetPasswordSchema, async ({ token, password }) => {
  await resetPassword(token, password);
  return { reset: true };
});

export const verifyEmailAction = publicAction(z.object({ token: z.string().min(20).max(200) }), async ({ token }) => {
  await verifyEmail(token);
  return { verified: true };
});

export const resendVerificationAction = authedAction(z.object({}), async (_input, user) => {
  await resendVerification(user.id);
  return { sent: true };
});

/** Signs into the shared demo account (only when DEMO_MODE is on). */
export const demoSignInAction = publicAction(z.object({}), async () => {
  if (!isEnabled("DEMO_MODE")) throw new AppError("FEATURE_DISABLED", "Demo mode is turned off on this server.");
  const demo = await ensureDemoUser();
  await createSession(demo.id);
  await audit(demo.id, "auth.sign_in", { type: "user", id: demo.id }, { demo: true });
  return { userId: demo.id };
});

export async function signOutAction() {
  const user = await getSessionUser();
  await destroyCurrentSession();
  if (user) await audit(user.id, "auth.sign_out", { type: "user", id: user.id });
  redirect("/sign-in");
}
