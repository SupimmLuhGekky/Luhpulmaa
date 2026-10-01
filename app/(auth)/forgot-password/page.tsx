import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { isDesktop } from "@/lib/config/env";
import { AuthHeading } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/password-forms";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  if (isDesktop()) {
    // The Mac app can't send email. Its menu creates a one-time reset link instead, which only
    // the person signed in to this Mac (with access to Harbour's keychain item) can do.
    return (
      <EmptyState
        icon={KeyRound}
        title="Reset your password from the menu bar"
        description="Harbour for Mac doesn't send email. In the menu bar, choose Harbour, then Reset Password…, pick your account, and choose a new password."
        action={
          <Button asChild variant="outline">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        }
      />
    );
  }
  return (
    <>
      <AuthHeading title="Reset your password" subtitle="Enter your email and we'll send you a secure reset link." />
      <ForgotPasswordForm />
    </>
  );
}
