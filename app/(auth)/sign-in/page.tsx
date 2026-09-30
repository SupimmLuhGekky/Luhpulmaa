import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getSessionUser } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  const user = await getSessionUser();
  if (user) redirect(user.onboardingCompletedAt ? "/dashboard" : "/onboarding");
  return (
    <>
      <AuthHeading title="Welcome back" subtitle="Sign in to see your accounts, budgets and goals." />
      <SignInForm next={next} reason={reason} demoEnabled={isEnabled("DEMO_MODE")} />
    </>
  );
}
