"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { setIncludeSavingsAction, updateCashBufferAction } from "@/app/actions/forecast";
import { cn } from "@/lib/utils";

/** Edit the minimum cash buffer (never counted as spendable; the forecast's warning line). */
export function BufferDialog({ open, onOpenChange, current }: { open: boolean; onOpenChange: (open: boolean) => void; current: number }) {
  const fmt = useFormat();
  const router = useRouter();
  const [cents, setCents] = React.useState<number | null>(current);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCents(current);
      setError(null);
    }
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = cents ?? 0;
    if (value < 0 || value > 100_000_000) {
      setError("Enter an amount between $0 and $1,000,000");
      return;
    }
    setSaving(true);
    const res = await updateCashBufferAction({ minCashBufferCents: value });
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Cash buffer updated", { description: `${fmt.money(value)} is kept aside from safe to spend.` });
    onOpenChange(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Cash buffer</DialogTitle>
          <DialogDescription>A cushion that safe to spend never counts as spendable. The forecast warns you when your balance might drop below it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="pb-4">
            <Field label="Keep at least" error={error ?? undefined} hint="Use $0 for no buffer.">
              <CurrencyInput value={cents} onChange={setCents} currency={fmt.currency} locale={fmt.locale} autoFocus />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save buffer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The user's cash buffer, whether savings count as spendable, and the next expected payday. */
export function BufferCard({ buffer, includesSavings, nextPayday, onEditBuffer, className }: {
  buffer: number;
  includesSavings: boolean;
  nextPayday: { date: string; amount: number; label: string } | null;
  onEditBuffer: () => void;
  className?: string;
}) {
  const fmt = useFormat();
  const router = useRouter();
  const [savings, setSavings] = React.useState(includesSavings);
  const [base, setBase] = React.useState(includesSavings);
  if (base !== includesSavings) {
    setBase(includesSavings);
    setSavings(includesSavings);
  }
  const [pending, startTransition] = React.useTransition();
  const toggleSavings = (include: boolean) => {
    setSavings(include);
    startTransition(async () => {
      const res = await setIncludeSavingsAction({ include });
      if (!res.ok) {
        setSavings(!include);
        toast.error("Couldn't change the setting", { description: res.error.message });
        return;
      }
      toast.success(include ? "Savings now count as spendable" : "Savings no longer count as spendable");
      router.refresh();
    });
  };

  return (
    <Card className={cn("flex min-w-0 flex-col divide-y divide-border", className)}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">Cash buffer</h2>
          </div>
          <Button variant="outline" size="sm" onClick={onEditBuffer}>
            Edit<span className="sr-only"> cash buffer</span>
          </Button>
        </div>
        <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-foreground">{fmt.money(buffer)}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{buffer > 0 ? "Kept aside: never counted as safe to spend." : "No buffer set. Everything above your plans counts as spendable."}</p>
      </div>
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <Label htmlFor="include-savings">Count savings as spendable</Label>
          <p id="include-savings-hint" className="mt-1 text-xs text-muted-foreground">
            {savings ? "Savings account balances are included in available cash." : "Only chequing and cash accounts are included."}
          </p>
        </div>
        <Switch id="include-savings" checked={savings} onCheckedChange={toggleSavings} disabled={pending} aria-describedby="include-savings-hint" />
      </div>
      <div className="p-5">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">Next payday</h2>
        </div>
        {nextPayday ? (
          <>
            <p className="mt-2 text-sm text-foreground">
              <span className="font-medium">{fmt.date(nextPayday.date, "weekdayShort")}</span> · <span className="tabular">{fmt.money(nextPayday.amount)}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Expected from {nextPayday.label} (estimate)</p>
          </>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">No payday expected in the forecast window.</p>
        )}
        <Link href="/income" className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline">
          Manage income
        </Link>
      </div>
    </Card>
  );
}
