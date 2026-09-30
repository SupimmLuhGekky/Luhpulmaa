import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";
import { AppError } from "@/lib/api/errors";

/** For pages: returns the signed-in user or redirects to sign-in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?reason=session");
  return user;
}

/** For pages inside the app shell: also sends first-time users to onboarding. */
export async function requireOnboardedUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  return user;
}

/** For server actions and API routes: throws a 401 AppError instead of redirecting. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHORIZED", "Your session has expired. Please sign in again.");
  return user;
}
