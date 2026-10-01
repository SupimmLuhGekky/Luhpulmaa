"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { accountUpdateSchema } from "@/lib/accounts/schemas";
import { updateAccountAction } from "@/app/actions/accounts";
import { MoneyField } from "./money-field";
import type { AccountView } from "./types";

const schema = z.object({ balanceCents: accountUpdateSchema.shape.balanceCents.unwrap() });
type Values = z.infer<typeof schema>;

/** Manual accounts: record today's balance (assets: amount held; debts: amount owed). */
export function UpdateBalanceDialog({ account, open, onOpenChange }: { account: Pick<AccountView, "id" | "name" | "currency" | "currentBalanceCents" | "isLiability">; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const f = useFormat();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { balanceCents: account.currentBalanceCents } });

  React.useEffect(() => {
    if (open) {
      form.reset({ balanceCents: account.currentBalanceCents });
      setError(null);
    }
  }, [open, account.currentBalanceCents, form]);

  const onSubmit = form.handleSubmit(async ({ balanceCents }) => {
    setError(null);
    const res = await updateAccountAction({ id: account.id, patch: { balanceCents } });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Balance updated", { description: `${account.name}: ${f.money(balanceCents, { currency: account.currency })}${account.isLiability ? " owed" : ""}` });
    onOpenChange(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !form.formState.isSubmitting && onOpenChange(o)}>
      <DialogContent size="sm" aria-describedby="balance-desc">
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Update balance</DialogTitle>
            <DialogDescription id="balance-desc">
              {account.name} doesn&apos;t sync with a bank. Enter {account.isLiability ? "what you owe" : "what's in it"} today, {f.date(f.today, "long")}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <FormError message={error} />
            <Field label={account.isLiability ? "Amount owed" : "Current balance"} error={form.formState.errors.balanceCents?.message} hint={account.isLiability ? "A positive amount." : "Use a minus sign if the account is overdrawn."} required>
              <MoneyField control={form.control} name="balanceCents" currency={account.currency} locale={f.locale} allowNegative={!account.isLiability} autoFocus />
            </Field>
            <p className="text-xs text-muted-foreground">This only updates Harbour&apos;s records and today&apos;s point in the balance history. No money moves.</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save balance
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
