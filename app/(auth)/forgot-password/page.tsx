import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/password-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading title="Reset your password" subtitle="Enter your email and we'll send you a secure reset link." />
      <ForgotPasswordForm />
    </>
  );
}
