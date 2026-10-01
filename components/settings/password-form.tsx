"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { passwordSchema } from "@/lib/auth/schemas";
import { changePasswordAction } from "@/app/actions/settings";
import { SettingsSection } from "./settings-ui";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });

type Values = z.infer<typeof schema>;

export function PasswordForm({ isDemo, passwordChangedAt }: { isDemo: boolean; passwordChangedAt: string | null }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await changePasswordAction(v);
    if (!res.ok) {
      const fieldErrors = Object.entries(res.error.fieldErrors ?? {}).filter(([key, msgs]) => key in v && msgs.length > 0);
      for (const [key, msgs] of fieldErrors) form.setError(key as keyof Values, { message: msgs[0] }, { shouldFocus: true });
      // The message under the field says it already; the banner is for anything else.
      setError(fieldErrors.length ? null : res.error.message);
      return;
    }
    form.reset();
    toast.success("Password changed", { description: "Other devices were signed out. This one stays signed in." });
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsSection
        id="password"
        title="Password"
        description={passwordChangedAt ? `Last changed ${passwordChangedAt}` : "Use a long password you don't use anywhere else."}
        footer={
          <Button type="submit" loading={form.formState.isSubmitting} disabled={isDemo}>
            Change password
          </Button>
        }
      >
        {isDemo ? (
          <Notice tone="neutral">The shared demo account&apos;s password can&apos;t be changed.</Notice>
        ) : (
          <div className="space-y-4">
            <FormError message={error} />
            <Field label="Current password" error={errors.currentPassword?.message}>
              <Input type="password" autoComplete="current-password" {...form.register("currentPassword")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password" hint="At least 10 characters, with a letter and a number." error={errors.newPassword?.message}>
                <Input type="password" autoComplete="new-password" {...form.register("newPassword")} />
              </Field>
              <Field label="Confirm new password" error={errors.confirmPassword?.message}>
                <Input type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Changing your password signs you out everywhere else.</p>
          </div>
        )}
      </SettingsSection>
    </form>
  );
}
