"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/shared/field";
import { signUpSchema } from "@/lib/auth/schemas";
import { signUpAction } from "@/app/actions/auth";

type Values = z.input<typeof signUpSchema>;

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(signUpSchema), defaultValues: { firstName: "", lastName: "", email: "", password: "" } });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await signUpAction(values);
    if (!res.ok) {
      setError(res.error.message);
      for (const [key, msgs] of Object.entries(res.error.fieldErrors ?? {})) form.setError(key as keyof Values, { message: msgs[0] });
      return;
    }
    router.replace("/onboarding");
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={error} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" error={errors.firstName?.message}>
          <Input autoComplete="given-name" autoFocus {...form.register("firstName")} />
        </Field>
        <Field label="Last name" error={errors.lastName?.message}>
          <Input autoComplete="family-name" {...form.register("lastName")} />
        </Field>
      </div>
      <Field label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
      </Field>
      <Field label="Password" hint="At least 10 characters with a letter and a number." error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Create account
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        By creating an account you agree to our{" "}
        <Link href="/legal" className="underline underline-offset-2">
          terms and privacy notice
        </Link>
        . We never sell your financial data.
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
