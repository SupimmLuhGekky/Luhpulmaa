"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { BadgeCheck, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FormError } from "@/components/shared/field";
import { FieldSlot } from "@/components/settings/field-slot";
import { updateProfileAction } from "@/app/actions/settings";
import { resendVerificationAction } from "@/app/actions/auth";
import { SettingsSection } from "./settings-ui";

const schema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name").max(60),
    lastName: z.string().trim().min(1, "Enter your last name").max(60),
    country: z.enum(["CA", "US"]),
    province: z.string(),
  })
  .refine((v) => v.country !== "CA" || v.province.length > 0, { message: "Choose your province or territory", path: ["province"] });

type Values = z.infer<typeof schema>;

export interface ProfileFormProps {
  profile: { firstName: string; lastName: string; email: string; emailVerified: boolean; country: string; province: string | null; isDemo: boolean };
  provinces: { code: string; name: string }[];
  /** False in the Mac app, which never sends email: no verification prompts there. */
  sendsEmail: boolean;
}

export function ProfileForm({ profile, provinces, sendsEmail }: ProfileFormProps) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: profile.firstName,
      lastName: profile.lastName,
      country: profile.country === "US" ? "US" : "CA",
      province: profile.province ?? "",
    },
  });
  const errors = form.formState.errors;
  const country = form.watch("country");

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await updateProfileAction({ firstName: v.firstName, lastName: v.lastName, country: v.country, province: v.country === "CA" ? v.province : null });
    if (!res.ok) {
      setError(res.error.message);
      for (const [key, msgs] of Object.entries(res.error.fieldErrors ?? {})) form.setError(key as keyof Values, { message: msgs[0] });
      return;
    }
    toast.success("Profile saved");
    form.reset(v);
    router.refresh();
  });

  const resend = async () => {
    setSending(true);
    const res = await resendVerificationAction({});
    setSending(false);
    if (res.ok) toast.success("Verification email sent", { description: `Check ${profile.email}.` });
    else toast.error(res.error.message);
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsSection
        id="profile"
        title="Personal details"
        description={sendsEmail ? "Your name appears in the app and in emails from Harbour." : "Your name appears in the app."}
        footer={
          <>
            {form.formState.isDirty ? (
              <Button type="button" variant="ghost" onClick={() => form.reset()} disabled={form.formState.isSubmitting}>
                Discard
              </Button>
            ) : null}
            <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={errors.firstName?.message} required>
              <Input autoComplete="given-name" {...form.register("firstName")} />
            </Field>
            <Field label="Last name" error={errors.lastName?.message} required>
              <Input autoComplete="family-name" {...form.register("lastName")} />
            </Field>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-[13px] font-medium leading-none text-foreground">Email</p>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-subtle px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{profile.email}</span>
              {!sendsEmail ? null : profile.emailVerified ? (
                <Badge variant="positive">
                  <BadgeCheck aria-hidden /> Verified
                </Badge>
              ) : (
                <Badge variant="warning">
                  <MailWarning aria-hidden /> Not verified
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {profile.isDemo
                ? "The demo account's email can't be changed."
                : !sendsEmail
                  ? "You sign in with this address. The Mac app keeps everything on this computer and never sends email."
                  : profile.emailVerified
                    ? "To use a different email address, contact support. Email changes need re-verification."
                    : "Verify your email so we can reach you about security and sync problems."}
              {sendsEmail && !profile.emailVerified && !profile.isDemo ? (
                <>
                  {" "}
                  <Button type="button" variant="link" size="sm" className="h-auto text-xs" onClick={resend} disabled={sending}>
                    {sending ? "Sending…" : "Resend verification email"}
                  </Button>
                </>
              ) : null}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Country" error={errors.country?.message}>
              <FieldSlot
                render={(a) => (
                  <Controller
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <Select
                        {...a}
                        value={field.value}
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          if (e.target.value !== "CA") form.setValue("province", "", { shouldDirty: true });
                        }}
                        options={[
                          { value: "CA", label: "Canada" },
                          { value: "US", label: "United States" },
                        ]}
                      />
                    )}
                  />
                )}
              />
            </Field>
            {country === "CA" ? (
              <Field label="Province or territory" error={errors.province?.message} required>
                <Select placeholder="Choose…" options={provinces.map((p) => ({ value: p.code, label: p.name }))} {...form.register("province")} />
              </Field>
            ) : null}
          </div>
        </div>
      </SettingsSection>
    </form>
  );
}
