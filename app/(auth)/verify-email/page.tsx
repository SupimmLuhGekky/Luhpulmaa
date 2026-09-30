import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth/auth-card";
import { VerifyEmailPanel } from "@/components/auth/password-forms";
import { Notice } from "@/components/shared/notice";

export const metadata: Metadata = { title: "Confirm email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <AuthHeading title="Confirm your email" subtitle="One click and you're done." />
      {token ? (
        <VerifyEmailPanel token={token} />
      ) : (
        <Notice tone="danger" title="This confirmation link is incomplete">
          Open the link from your email again, or request a new one from <Link href="/settings/security" className="underline">Settings → Security</Link>.
        </Notice>
      )}
    </>
  );
}
