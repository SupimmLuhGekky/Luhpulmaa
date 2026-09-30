import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <>
      <AuthHeading title="Create your account" subtitle="Free to use. Connect a bank later or start with manual accounts." />
      <SignUpForm />
    </>
  );
}
