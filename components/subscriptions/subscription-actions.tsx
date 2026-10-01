"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { reminderLabel } from "@/components/bills/status";
import { deleteSubscriptionAction, markRecurringAsSubscriptionAction, unmarkSubscriptionAction, updateSubscriptionAction } from "@/app/actions/subscriptions";
import { SUBSCRIPTION_FREQUENCIES } from "@/lib/subscriptions/upcoming";
import { SubscriptionDialog } from "./subscription-dialog";
import type { RecurringCandidate, SubscriptionFormOptions, SubscriptionRow, SubscriptionStatus } from "./types";

interface SubscriptionActionsValue {
  isPending: (id: string) => boolean;
  add: () => void;
  edit: (sub: SubscriptionRow) => void;
  remove: (sub: SubscriptionRow) => void;
  setStatus: (sub: SubscriptionRow, status: SubscriptionStatus) => void;
  setReminder: (sub: SubscriptionRow, days: number | null) => void;
  unmark: (sub: SubscriptionRow) => void;
  markRecurring: (candidate: RecurringCandidate) => void;
}

const Ctx = React.createContext<SubscriptionActionsValue | null>(null);

export function useSubscriptionActions() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useSubscriptionActions must be used inside SubscriptionActionsProvider");
  return ctx;
}

const STATUS_TOASTS: Record<SubscriptionStatus, { title: string; description: string }> = {
  ACTIVE: { title: "is active again", description: "It's back in your totals, reminders and cash-flow estimate." },
  PAUSED: { title: "paused", description: "It's left out of your totals and reminders until you resume it." },
  CANCELLED: { title: "marked as cancelled", description: "This only updates Harbour. If you haven't yet, cancel it with the provider." },
};

/** Owns subscription mutations for the page (dialogs, confirmations, toasts and refresh). */
export function SubscriptionActionsProvider({ options, initialCreate, onCreateClosed, children }: {
  options: SubscriptionFormOptions;
  initialCreate?: boolean;
  onCreateClosed?: () => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<Set<string>>(() => new Set());
  const [editing, setEditing] = React.useState<{ open: boolean; sub: SubscriptionRow | null }>({ open: Boolean(initialCreate), sub: null });
  const [deleting, setDeleting] = React.useState<SubscriptionRow | null>(null);
  const [createRequest, setCreateRequest] = React.useState(Boolean(initialCreate));
  if (Boolean(initialCreate) !== createRequest) {
    setCreateRequest(Boolean(initialCreate));
    if (initialCreate) setEditing({ open: true, sub: null });
  }

  const run = React.useCallback(
    async <T,>(id: string, action: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>, failure: string): Promise<T | null> => {
      setPending((s) => new Set(s).add(id));
      try {
        const res = await action();
        if (!res.ok) {
          toast.error(failure, { description: res.error.message });
          return null;
        }
        router.refresh();
        return res.data;
      } finally {
        setPending((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [router],
  );

  const value = React.useMemo<SubscriptionActionsValue>(() => {
    const markRecurring = async (c: Pick<RecurringCandidate, "id" | "name">) => {
      const res = await run(c.id, () => markRecurringAsSubscriptionAction({ recurringId: c.id }), "Couldn't add the subscription");
      if (res) {
        toast.success(`${c.name} added to subscriptions`, {
          description: "It's now in your subscription totals.",
          action: { label: "Undo", onClick: () => void run(res.id, () => unmarkSubscriptionAction({ id: res.id }), "Couldn't undo") },
        });
      }
    };
    return {
      isPending: (id) => pending.has(id),
      add: () => setEditing({ open: true, sub: null }),
      edit: (sub) => setEditing({ open: true, sub }),
      remove: (sub) => setDeleting(sub),
      setStatus: async (sub, status) => {
        const res = await run(sub.id, () => updateSubscriptionAction({ id: sub.id, patch: { status } }), "Couldn't update the subscription");
        if (res) toast.success(`${sub.name} ${STATUS_TOASTS[status].title}`, { description: STATUS_TOASTS[status].description });
      },
      setReminder: async (sub, days) => {
        const res = await run(sub.id, () => updateSubscriptionAction({ id: sub.id, patch: { reminderDaysBefore: days } }), "Couldn't change the reminder");
        if (res) toast.success(days === null ? `Reminders off for ${sub.name}` : `${sub.name}: reminder ${reminderLabel(days).toLowerCase()}`);
      },
      unmark: async (sub) => {
        const res = await run(sub.id, () => unmarkSubscriptionAction({ id: sub.id }), "Couldn't update the subscription");
        if (!res) return;
        // Undo re-creates the subscription from its series, then restores what the user had set.
        const undo = () =>
          run(res.recurringId, async () => {
            const created = await markRecurringAsSubscriptionAction({ recurringId: res.recurringId });
            if (!created.ok) return created;
            return updateSubscriptionAction({
              id: created.data.id,
              patch: {
                name: sub.name,
                amountCents: sub.amountCents,
                ...((SUBSCRIPTION_FREQUENCIES as readonly string[]).includes(sub.frequency) ? { frequency: sub.frequency as (typeof SUBSCRIPTION_FREQUENCIES)[number] } : {}),
                nextChargeDate: sub.nextChargeDate,
                categoryId: sub.category?.id ?? null,
                accountId: sub.account?.id ?? null,
                reminderDaysBefore: sub.reminderDaysBefore,
                status: sub.status,
                notes: sub.notes,
              },
            });
          }, "Couldn't undo");
        toast.success(`${sub.name} is no longer a subscription`, {
          description: "Harbour still tracks it as a repeating charge.",
          action: { label: "Undo", onClick: () => void undo() },
        });
      },
      markRecurring: (c) => void markRecurring(c),
    };
  }, [pending, run]);

  const closeEditor = (open: boolean) => {
    if (open) return;
    const wasCreate = !editing.sub;
    setEditing((e) => ({ ...e, open: false }));
    if (wasCreate) onCreateClosed?.();
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <SubscriptionDialog
        open={editing.open}
        onOpenChange={closeEditor}
        subscription={editing.sub}
        options={options}
        onSaved={() => {
          closeEditor(false);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : "Delete subscription?"}
        description={
          deleting?.recurringId
            ? "It's removed from Harbour and its repeating charge won't be suggested again. Your transactions aren't affected, and nothing changes with the provider."
            : "It's removed from Harbour. Your transactions aren't affected, and nothing changes with the provider."
        }
        confirmLabel="Delete subscription"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteSubscriptionAction({ id: deleting.id });
          if (!res.ok) {
            toast.error("Couldn't delete the subscription", { description: res.error.message });
            return;
          }
          toast.success(`${deleting.name} deleted`);
          setDeleting(null);
          router.refresh();
        }}
      />
    </Ctx.Provider>
  );
}
