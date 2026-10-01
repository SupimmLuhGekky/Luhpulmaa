"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, FormError } from "@/components/shared/field";
import { deleteAccountAction, disconnectAllConnectionsAction, updatePreferencesAction } from "@/app/actions/settings";
import { SettingRow } from "./settings-ui";

/** The single switch that lets optional AI features read this user's data. */
export function AiOptInSwitch({ initial, available, features }: { initial: boolean; available: boolean; features: string[] }) {
  const router = useRouter();
  const [on, setOn] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  const change = async (value: boolean) => {
    setOn(value);
    setSaving(true);
    const res = await updatePreferencesAction({ aiOptIn: value });
    setSaving(false);
    if (!res.ok) {
      setOn(!value);
      toast.error("Couldn't change AI features", { description: res.error.message });
      return;
    }
    toast.success(value ? "AI features turned on" : "AI features turned off", {
      description: value ? undefined : "Nothing more is sent. Answers already shown aren't stored by Harbour.",
    });
    router.refresh();
  };

  return (
    <SettingRow
      label="Allow AI features to read my data"
      description={available ? `Used by: ${features.join(" and ")}. Off unless you turn it on.` : "Not available on this server."}
      htmlFor="ai-opt-in"
      inline
    >
      <Switch id="ai-opt-in" checked={available && on} onCheckedChange={change} disabled={!available || saving} />
    </SettingRow>
  );
}

export function DisconnectAllButton({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={count === 0}>
        <Unplug /> Disconnect all
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Disconnect ${count} ${count === 1 ? "bank connection" : "bank connections"}?`}
        description={`Harbour stops syncing and deletes the stored access ${count === 1 ? "to it" : "to each one"}. Your accounts and history stay here, marked as disconnected. Nothing changes at your ${count === 1 ? "bank" : "banks"}.`}
        confirmLabel="Disconnect all"
        destructive
        onConfirm={async () => {
          const res = await disconnectAllConnectionsAction({ confirm: true });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success(res.data.disconnected === 1 ? "1 connection disconnected" : `${res.data.disconnected} connections disconnected`);
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

/** Permanent account deletion: needs the password and typing DELETE. */
export function DeleteAccountButton({ isDemo }: { isDemo: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [errors, setErrors] = React.useState<{ password?: string; confirmation?: string; form?: string }>({});
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirmation("");
      setErrors({});
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!password) next.password = "Enter your password";
    if (confirmation.trim().toUpperCase() !== "DELETE") next.confirmation = "Type DELETE to confirm";
    setErrors(next);
    if (next.password || next.confirmation) return;
    setPending(true);
    const res = await deleteAccountAction({ password, confirmation });
    if (!res.ok) {
      setPending(false);
      setErrors({
        password: res.error.fieldErrors?.password?.[0],
        confirmation: res.error.fieldErrors?.confirmation?.[0],
        form: res.error.fieldErrors ? undefined : res.error.message,
      });
      return;
    }
    // The session is gone: leave the app completely.
    window.location.assign("/sign-in?reason=deleted");
  };

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)} disabled={isDemo}>
        <Trash2 /> Delete account…
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent size="sm" role="alertdialog">
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This permanently deletes your profile, accounts, transactions, budgets, goals and settings, and disconnects every bank. It can&apos;t be undone. Download an export first if you
                want a copy.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <FormError message={errors.form} />
              <Field label="Your password" error={errors.password} required>
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              </Field>
              <Field label="Type DELETE to confirm" error={errors.confirmation} required>
                <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="DELETE" />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" loading={pending}>
                Delete everything
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
