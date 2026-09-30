"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Field, FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { signInSchema } from "@/lib/auth/schemas";
import { demoSignInAction, signInAction } from "@/app/actions/auth";

type Values = z.input<typeof signInSchema>;

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function SignInForm({ next, demoEnabled, reason }: { next?: string; demoEnabled: boolean; reason?: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [demoPending, startDemo] = React.useTransition();
  const form = useForm<Values>({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await signInAction(values);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    router.replace(res.data.onboarded ? safeNext(next) : "/onboarding");
    router.refresh();
  });

  return (
    <div className="space-y-5">
      {reason === "session" ? <Notice tone="warning" title="Your session expired">Please sign in again to continue.</Notice> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={error} />
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" autoFocus {...form.register("email")} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register("password")} />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
      {demoEnabled ? (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" /> or <Separator className="flex-1" />
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            loading={demoPending}
            onClick={() =>
              startDemo(async () => {
                setError(null);
                const res = await demoSignInAction({});
                if (!res.ok) {
                  setError(res.error.message);
                  return;
                }
                router.replace("/dashboard");
                router.refresh();
              })
            }
          >
            <Sparkles /> Explore the demo account
          </Button>
        </>
      ) : null}
      <p className="text-center text-sm text-muted-foreground">
        New to Harbour?{" "}
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
