"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { occurrenceStatus, type OccurrenceStatus } from "@/lib/bills/calendar";
import { deleteBillAction, setBillPaidAction, updateBillAction } from "@/app/actions/bills";
import { BillDialog } from "./bill-dialog";
import { occurrenceKey, type BillFormOptions, type BillRow, type Occurrence } from "./types";

interface Override {
  paid: boolean;
  amountCents?: number;
}

interface BillActionsValue {
  /** The occurrence with any just-made (not yet refreshed) paid change applied. */
  resolve: (o: Occurrence) => Occurrence;
  statusOf: (o: Occurrence) => OccurrenceStatus;
  isPending: (o: Occurrence) => boolean;
  markPaid: (o: Occurrence) => void;
  markUnpaid: (o: Occurrence) => void;
  addBill: () => void;
  editBill: (billId: string) => void;
  deleteBill: (billId: string) => void;
  setActive: (billId: string, active: boolean) => void;
}

const BillActionsContext = React.createContext<BillActionsValue | null>(null);

export function useBillActions() {
  const ctx = React.useContext(BillActionsContext);
  if (!ctx) throw new Error("useBillActions must be used inside BillActionsProvider");
  return ctx;
}

const EMPTY = new Map<string, Override>();

/**
 * Owns bill mutations for the page: marking occurrences paid/unpaid (shown
 * immediately, confirmed by the server refresh), adding, editing, pausing and
 * deleting bills, with toasts and an undo for paid changes.
 */
export function BillActionsProvider({ data, bills, options, initialCreate, onCreateClosed, children }: {
  /** Identity changes when the server sends fresh data; pending overrides are dropped then. */
  data: unknown;
  bills: BillRow[];
  options: BillFormOptions;
  initialCreate?: boolean;
  onCreateClosed?: () => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const fmt = useFormat();
  const [ov, setOv] = React.useState<{ base: unknown; map: Map<string, Override> }>({ base: data, map: EMPTY });
  const overrides = ov.base === data ? ov.map : EMPTY;
  const [pending, setPending] = React.useState<Set<string>>(() => new Set());
  const [editing, setEditing] = React.useState<{ open: boolean; bill: BillRow | null }>({ open: Boolean(initialCreate), bill: null });
  const [deleting, setDeleting] = React.useState<BillRow | null>(null);
  const [amountFor, setAmountFor] = React.useState<Occurrence | null>(null);
  // `?new=1` can also arrive while the page is open (command palette, quick add).
  const [createRequest, setCreateRequest] = React.useState(Boolean(initialCreate));
  if (Boolean(initialCreate) !== createRequest) {
    setCreateRequest(Boolean(initialCreate));
    if (initialCreate) setEditing({ open: true, bill: null });
  }

  const setOverride = React.useCallback(
    (key: string, value: Override | null) =>
      setOv((prev) => {
        const map = new Map(prev.base === data ? prev.map : EMPTY);
        if (value) map.set(key, value);
        else map.delete(key);
        return { base: data, map };
      }),
    [data],
  );

  const resolve = React.useCallback(
    (o: Occurrence): Occurrence => {
      const x = overrides.get(occurrenceKey(o));
      return x ? { ...o, paid: x.paid, amountCents: x.amountCents ?? o.amountCents } : o;
    },
    [overrides],
  );

  const setPaid = React.useCallback(
    async (o: Occurrence, paid: boolean, amountCents?: number, opts: { undo?: boolean } = {}) => {
      const key = occurrenceKey(o);
      setPending((s) => new Set(s).add(key));
      setOverride(key, { paid, amountCents });
      const res = await setBillPaidAction({ billId: o.billId, dueDate: o.dueDate, paid, amountCents });
      setPending((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      if (!res.ok) {
        setOverride(key, null);
        toast.error(paid ? "Couldn't mark the bill paid" : "Couldn't mark the bill unpaid", { description: res.error.message });
        return;
      }
      if (!opts.undo) {
        toast.success(paid ? `${o.name} marked paid` : `${o.name} marked unpaid`, {
          description: paid ? `${fmt.money(amountCents ?? o.amountCents)} due ${fmt.date(o.dueDate, "monthDay")}. Recorded for your tracking only.` : `Due ${fmt.date(o.dueDate, "monthDay")}.`,
          action: { label: "Undo", onClick: () => void setPaid(o, !paid, paid ? undefined : o.amountCents, { undo: true }) },
        });
      }
      router.refresh();
    },
    [fmt, router, setOverride],
  );

  const value = React.useMemo<BillActionsValue>(
    () => ({
      resolve,
      statusOf: (o) => occurrenceStatus(resolve(o), fmt.today),
      isPending: (o) => pending.has(occurrenceKey(o)),
      markPaid: (o) => (o.isVariableAmount ? setAmountFor(o) : void setPaid(o, true)),
      markUnpaid: (o) => void setPaid(o, false),
      addBill: () => setEditing({ open: true, bill: null }),
      editBill: (billId) => {
        const bill = bills.find((b) => b.id === billId);
        if (bill) setEditing({ open: true, bill });
      },
      deleteBill: (billId) => setDeleting(bills.find((b) => b.id === billId) ?? null),
      setActive: async (billId, active) => {
        const bill = bills.find((b) => b.id === billId);
        const res = await updateBillAction({ id: billId, patch: { isActive: active } });
        if (!res.ok) {
          toast.error(active ? "Couldn't resume the bill" : "Couldn't pause the bill", { description: res.error.message });
          return;
        }
        toast.success(active ? `${bill?.name ?? "Bill"} resumed` : `${bill?.name ?? "Bill"} paused`, { description: active ? "It's back on your calendar." : "It's hidden from your calendar and estimates until you resume it." });
        router.refresh();
      },
    }),
    [bills, fmt.today, pending, resolve, router, setPaid],
  );

  const closeEditor = (open: boolean) => {
    if (open) return;
    const wasCreate = !editing.bill;
    setEditing((e) => ({ ...e, open: false }));
    if (wasCreate) onCreateClosed?.();
  };

  return (
    <BillActionsContext.Provider value={value}>
      {children}
      <BillDialog
        open={editing.open}
        onOpenChange={closeEditor}
        bill={editing.bill}
        options={options}
        onSaved={() => {
          closeEditor(false);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : "Delete bill?"}
        description="Its schedule and paid records are removed from Harbour. Your transactions aren't affected."
        confirmLabel="Delete bill"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteBillAction({ id: deleting.id });
          if (!res.ok) {
            toast.error("Couldn't delete the bill", { description: res.error.message });
            return;
          }
          toast.success(`${deleting.name} deleted`);
          setDeleting(null);
          router.refresh();
        }}
      />
      <PaidAmountDialog
        occurrence={amountFor}
        onClose={() => setAmountFor(null)}
        onConfirm={(o, cents) => {
          setAmountFor(null);
          void setPaid(o, true, cents);
        }}
      />
    </BillActionsContext.Provider>
  );
}

/** Variable bills: confirm what was actually paid before recording it. */
function PaidAmountDialog({ occurrence, onClose, onConfirm }: { occurrence: Occurrence | null; onClose: () => void; onConfirm: (o: Occurrence, cents: number) => void }) {
  const fmt = useFormat();
  const [cents, setCents] = React.useState<number | null>(null);
  const [touched, setTouched] = React.useState(false);
  const [lastKey, setLastKey] = React.useState<string | null>(null);
  const key = occurrence ? occurrenceKey(occurrence) : null;
  if (key !== lastKey) {
    setLastKey(key);
    setCents(occurrence?.amountCents ?? null);
    setTouched(false);
  }
  const invalid = cents === null || cents <= 0 || cents > 100_000_000;
  return (
    <Dialog open={Boolean(occurrence)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Mark {occurrence?.name} paid</DialogTitle>
          <DialogDescription>
            Due {occurrence ? fmt.date(occurrence.dueDate, "long") : ""}. This amount varies — enter what you paid. Harbour only records it.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (occurrence && !invalid) onConfirm(occurrence, cents!);
          }}
        >
          <DialogBody className="pb-4">
            <Field label="Amount paid" error={touched && invalid ? "Enter an amount above zero" : undefined} hint={occurrence ? `Estimate: ${fmt.money(occurrence.amountCents)}` : undefined}>
              <CurrencyInput value={cents} onChange={setCents} currency={fmt.currency} locale={fmt.locale} autoFocus />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Mark paid</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
