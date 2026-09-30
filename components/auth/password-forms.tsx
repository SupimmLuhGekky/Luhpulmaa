"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/shared/field";
import { EmptyState } from "@/components/shared/empty-state";
import { forgotPasswordSchema, passwordSchema } from "@/lib/auth/schemas";
import { forgotPasswordAction, resetPasswordAction, verifyEmailAction } from "@/app/actions/auth";

export function ForgotPasswordForm() {
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });
  if (sent) {
    return (
      <EmptyState
        icon={MailCheck}
        title="Check your inbox"
        description="If an account exists for that email, we've sent a link to reset your password. The link expires in one hour."
        action={
          <Button asChild variant="outline">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        }
      />
    );
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        const res = await forgotPasswordAction(values);
        if (!res.ok) setError(res.error.message);
        else setSent(true);
      })}
    >
      <FormError message={error} />
      <Field label="Email" error={form.formState.errors.email?.message}>
        <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Send reset link
      </Button>
      <p className="text-center text-sm">
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const form = useForm<z.input<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });
  if (done) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Password updated"
        description="For your security, you've been signed out everywhere. Sign in with your new password."
        action={<Button onClick={() => router.push("/sign-in")}>Sign in</Button>}
      />
    );
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async ({ password }) => {
        setError(null);
        const res = await resetPasswordAction({ token, password });
        if (!res.ok) setError(res.error.message);
        else setDone(true);
      })}
    >
      <FormError message={error} />
      <Field label="New password" hint="At least 10 characters with a letter and a number." error={form.formState.errors.password?.message}>
        <Input type="password" autoComplete="new-password" autoFocus {...form.register("password")} />
      </Field>
      <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Update password
      </Button>
    </form>
  );
}

export function VerifyEmailPanel({ token }: { token: string }) {
  const [state, setState] = React.useState<"idle" | "pending" | "done" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  if (state === "done") {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Email confirmed"
        description="Thanks! Your email address is verified."
        action={
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      <FormError message={message} />
      <Button
        size="lg"
        className="w-full"
        loading={state === "pending"}
        onClick={async () => {
          setState("pending");
          const res = await verifyEmailAction({ token });
          if (res.ok) setState("done");
          else {
            setState("error");
            setMessage(res.error.message);
          }
        }}
      >
        Confirm my email
      </Button>
    </div>
  );
}
