import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/password-forms";
import { Notice } from "@/components/shared/notice";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <AuthHeading title="Choose a new password" />
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Notice tone="danger" title="This reset link is incomplete">
          Request a new link from the <Link href="/forgot-password" className="underline">reset page</Link>.
        </Notice>
      )}
    </>
  );
}
