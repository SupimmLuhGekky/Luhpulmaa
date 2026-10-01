"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, FormError } from "@/components/shared/field";
import { accountUpdateSchema, ACCOUNT_TYPES } from "@/lib/accounts/schemas";
import { connectionState } from "@/lib/accounts/summary";
import { hasCreditLimit, isLiability } from "@/lib/accounts/types";
import { deleteManualAccountAction, updateAccountAction } from "@/app/actions/accounts";
import { InstitutionIcon } from "./account-icon";
import { AccountTypeOptions } from "./account-type-options";
import { MoneyField } from "./money-field";
import { ConnectionStatusBadge } from "./account-badges";
import type { AccountFormat } from "./format";
import type { AccountView, ConnectionView } from "./types";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const detailsSchema = z.object({
  name: accountUpdateSchema.shape.name.unwrap(),
  type: z.enum(ACCOUNT_TYPES),
  creditLimitCents: accountUpdateSchema.shape.creditLimitCents.unwrap(),
});
type Details = z.infer<typeof detailsSchema>;

function SettingSwitch({ id, label, description, checked, disabled, onCheckedChange }: { id: string; label: string; description: string; checked: boolean; disabled?: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        <p id={`${id}-desc`} className="mt-1 text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} aria-describedby={`${id}-desc`} className="mt-0.5" />
    </div>
  );
}

export interface AccountSettingsProps {
  account: AccountView;
  connection: ConnectionView | null;
  bankingEnabled: boolean;
  transactionCount: number;
  f: AccountFormat;
  syncing: boolean;
  reconnecting: boolean;
  linkBusy: boolean;
  onSync: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onUpdateBalance: () => void;
}

export function AccountSettings({ account, connection, bankingEnabled, transactionCount, f, syncing, reconnecting, linkBusy, onSync, onReconnect, onDisconnect, onUpdateBalance }: AccountSettingsProps) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [flags, setFlags] = React.useState({ isHidden: account.isHidden, includeInNetWorth: account.includeInNetWorth });
  const [savingFlag, setSavingFlag] = React.useState<keyof typeof flags | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => setFlags({ isHidden: account.isHidden, includeInNetWorth: account.includeInNetWorth }), [account.isHidden, account.includeInNetWorth]);

  const defaults = React.useMemo<Details>(() => ({ name: account.name, type: account.type, creditLimitCents: account.creditLimitCents }), [account.name, account.type, account.creditLimitCents]);
  const form = useForm<Details>({ resolver: zodResolver(detailsSchema), defaultValues: defaults });
  React.useEffect(() => form.reset(defaults), [defaults, form]);
  const type = form.watch("type");
  const typeFlips = account.isManual && isLiability(type) !== account.isLiability;

  const save = form.handleSubmit(async (v) => {
    setError(null);
    const patch: z.input<typeof accountUpdateSchema> = {};
    if (v.name !== account.name) patch.name = v.name;
    if (account.isManual && v.type !== account.type) patch.type = v.type;
    if (account.isManual && hasCreditLimit(v.type) && v.creditLimitCents !== account.creditLimitCents) patch.creditLimitCents = v.creditLimitCents;
    if (!Object.keys(patch).length) return;
    const res = await updateAccountAction({ id: account.id, patch });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Changes saved");
    form.reset(v);
    router.refresh();
  });

  const toggle = async (key: keyof typeof flags, value: boolean) => {
    setFlags((s) => ({ ...s, [key]: value }));
    setSavingFlag(key);
    const res = await updateAccountAction({ id: account.id, patch: { [key]: value } });
    setSavingFlag(null);
    if (!res.ok) {
      setFlags((s) => ({ ...s, [key]: !value }));
      toast.error("Couldn't save that change", { description: res.error.message });
      return;
    }
    if (key === "isHidden") toast.success(value ? "Account hidden" : "Account visible again", { description: value ? "It's left out of account lists. Turn on “Show hidden accounts” to see it." : undefined });
    else toast.success(value ? "Counted in net worth" : "Left out of net worth");
    router.refresh();
  };

  const remove = async () => {
    const res = await deleteManualAccountAction({ id: account.id });
    if (!res.ok) {
      toast.error("Couldn't delete the account", { description: res.error.message });
      return;
    }
    toast.success(`${account.name} was deleted`);
    setConfirmDelete(false);
    router.push("/accounts");
    router.refresh();
  };

  const state = connection ? connectionState(connection.status) : null;

  return (
    <Card>
      <CardHeading title="Account settings" />
      <div className="space-y-5 px-5 pb-5">
        <form onSubmit={save} noValidate className="space-y-3" aria-label="Account details">
          <FormError message={error} />
          <Field label="Name" error={form.formState.errors.name?.message}>
            <Input autoComplete="off" maxLength={60} {...form.register("name")} />
          </Field>
          {account.isManual ? (
            <>
              <Field label="Type" error={form.formState.errors.type?.message} hint={typeFlips ? `As ${isLiability(type) ? "a debt" : "an asset"}, the balance of ${f.amount(account.currentBalanceCents, account.currency)} will count as ${isLiability(type) ? "an amount owed" : "money you have"}.` : undefined}>
                <Select {...form.register("type")}>
                  <AccountTypeOptions />
                </Select>
              </Field>
              {hasCreditLimit(type) ? (
                <Field label="Credit limit" error={form.formState.errors.creditLimitCents?.message} hint="Optional. Used to show how much of the limit is used.">
                  <MoneyField control={form.control} name="creditLimitCents" nullable currency={account.currency} locale={f.locale} placeholder="No limit set" />
                </Field>
              ) : null}
            </>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="outline" disabled={!form.formState.isDirty} loading={form.formState.isSubmitting}>
              Save changes
            </Button>
          </div>
        </form>

        <Separator />

        <div className="space-y-4">
          <SettingSwitch
            id="setting-hidden"
            label="Hide this account"
            description="Hidden accounts are left out of account lists and pickers. Their transactions stay in your history."
            checked={flags.isHidden}
            disabled={savingFlag === "isHidden"}
            onCheckedChange={(v) => void toggle("isHidden", v)}
          />
          <SettingSwitch
            id="setting-networth"
            label="Include in net worth"
            description="Count this balance in your net worth and in the totals on the accounts page."
            checked={flags.includeInNetWorth}
            disabled={savingFlag === "includeInNetWorth"}
            onCheckedChange={(v) => void toggle("includeInNetWorth", v)}
          />
        </div>

        <Separator />

        {account.isManual ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{account.isLiability ? "Amount owed" : "Balance"}</p>
                <p className="mt-1 text-xs text-muted-foreground">Manual accounts don&apos;t sync. Update the balance whenever it changes.</p>
              </div>
              <Button size="sm" variant="outline" onClick={onUpdateBalance}>
                Update balance
              </Button>
            </div>
            <div className="rounded-lg border border-danger/25 p-3">
              <p className="text-[13px] font-medium">Delete this account</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Also deletes {transactionCount ? `its ${plural(transactionCount, "transaction")}` : "its balance history"}. This can&apos;t be undone.
              </p>
              <Button size="sm" variant="outline" className="mt-3 text-danger hover:bg-danger-soft" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden /> Delete account…
              </Button>
            </div>
          </div>
        ) : connection && state ? (
          <div>
            <p className="text-[13px] font-medium">Bank connection</p>
            <div className="mt-2 rounded-lg border border-border p-3">
              <div className="flex items-start gap-3">
                <InstitutionIcon color={connection.color} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 truncate text-[13px] font-medium">{connection.institution}</p>
                    <ConnectionStatusBadge status={connection.status} />
                    {connection.provider === "MOCK" ? <Badge variant="info">Simulated</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground" title={connection.lastSyncedAt ? f.dateTime(connection.lastSyncedAt) : undefined}>
                    {plural(connection.accountCount, "account")} · {connection.lastSyncedAt ? `${connection.status === "DISCONNECTED" ? "Last synced" : "Synced"} ${f.ago(connection.lastSyncedAt)}` : "Never synced"}
                  </p>
                  {connection.lastSyncError ? <p className="mt-1.5 text-xs text-danger">{connection.lastSyncError}</p> : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {state.needsReconnect && bankingEnabled ? (
                  <Button size="sm" onClick={onReconnect} loading={reconnecting} disabled={linkBusy && !reconnecting}>
                    {reconnecting ? null : <RefreshCw aria-hidden />} Reconnect
                  </Button>
                ) : null}
                {state.canSync && bankingEnabled ? (
                  <Button size="sm" variant="outline" onClick={onSync} loading={syncing}>
                    {syncing ? null : <RefreshCw aria-hidden />} {syncing ? "Syncing…" : "Sync now"}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={onDisconnect}>
                  {connection.status === "DISCONNECTED" ? "Delete history…" : "Disconnect…"}
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">The balance, type and credit limit come from your bank.</p>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${account.name}?`}
        description={
          <>
            This permanently deletes the account
            {transactionCount ? ` and its ${plural(transactionCount, "transaction")}` : ""}. Budgets, reports and net worth won&apos;t include {transactionCount ? "them" : "it"} anymore. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete account"
        destructive
        onConfirm={remove}
      />
    </Card>
  );
}
