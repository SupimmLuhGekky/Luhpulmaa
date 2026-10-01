"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CategoryIcon } from "@/components/shared/category-icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, FormError } from "@/components/shared/field";
import { useFormat } from "@/components/providers/format-provider";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { deleteTransactionAction, getTransactionAction, updateTransactionAction } from "@/app/actions/transactions";
import type { QuickAddOptions } from "@/app/actions/shell";
import type { getTransaction } from "@/lib/transactions/service";
import { CategoryOptions } from "./category-options";

type Detail = Awaited<ReturnType<typeof getTransaction>>;

const SOURCE_LABELS: Record<string, string> = {
  PROVIDER: "Category from your bank",
  SYSTEM_RULE: "Categorized automatically",
  MERCHANT_RULE: "Categorized by a merchant rule",
  AUTOMATION: "Categorized by an automation",
  USER: "Changed by you",
  AI: "Suggested automatically — please check",
  UNCATEGORIZED: "Not categorized yet",
};

const CONTRIBUTION_LABELS: Record<string, string> = {
  PLANNED_ALLOCATION: "Planned for",
  USER_REPORTED_TRANSFER: "You reported moving money to",
  PROVIDER_TRANSFER: "Transfer matched to",
};

interface Draft {
  merchantName: string;
  categoryId: string;
  applyToMerchant: boolean;
  notes: string;
  tags: string;
  isRecurring: boolean;
  isTransfer: boolean;
  isExcluded: boolean;
  date: string;
  direction: "in" | "out";
  amountCents: number | null;
}

function draftFrom(t: Detail): Draft {
  return {
    merchantName: t.merchantName,
    categoryId: t.category?.id ?? "",
    applyToMerchant: false,
    notes: t.notes ?? "",
    tags: t.tags.map((x) => x.name).join(", "),
    isRecurring: t.isRecurring,
    isTransfer: t.isTransfer,
    isExcluded: t.isExcluded,
    date: t.date,
    direction: t.amountCents >= 0 ? "in" : "out",
    amountCents: Math.abs(t.amountCents),
  };
}

/** Side panel with everything about one transaction and the edits that make sense for it. */
export function TransactionDrawer({ id, onClose, categories }: { id: string | null; onClose: () => void; categories: QuickAddOptions["categories"] }) {
  const router = useRouter();
  const f = useFormat();
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setDetail(null);
    setDraft(null);
    setLoadError(null);
    setSaveError(null);
    getTransactionAction({ id }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setDetail(res.data);
        setDraft(draftFrom(res.data));
      } else setLoadError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const changes = React.useMemo(() => {
    if (!detail || !draft) return null;
    const patch: Record<string, unknown> = {};
    const tags = draft.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (draft.merchantName.trim() && draft.merchantName.trim() !== detail.merchantName) patch.merchantName = draft.merchantName.trim();
    if (draft.categoryId !== (detail.category?.id ?? "")) {
      patch.categoryId = draft.categoryId || null;
      if (draft.applyToMerchant && draft.categoryId) patch.applyToMerchant = true;
    }
    if ((draft.notes.trim() || null) !== (detail.notes ?? null)) patch.notes = draft.notes.trim() || null;
    if (tags.join("\u0000") !== detail.tags.map((t) => t.name).join("\u0000")) patch.tags = tags;
    if (draft.isRecurring !== detail.isRecurring) patch.isRecurring = draft.isRecurring;
    if (draft.isTransfer !== detail.isTransfer && patch.categoryId === undefined) patch.isTransfer = draft.isTransfer;
    if (draft.isExcluded !== detail.isExcluded) patch.isExcluded = draft.isExcluded;
    if (detail.isManual) {
      if (draft.date !== detail.date) patch.date = draft.date;
      const signed = draft.amountCents ? (draft.direction === "out" ? -draft.amountCents : draft.amountCents) : null;
      if (signed !== null && signed !== detail.amountCents) patch.amountCents = signed;
    }
    return patch;
  }, [detail, draft]);

  const dirty = !!changes && Object.keys(changes).length > 0;

  const save = async () => {
    if (!detail || !changes || !dirty) return;
    setSaving(true);
    setSaveError(null);
    const res = await updateTransactionAction({ id: detail.id, patch: changes });
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error.message);
      return;
    }
    setDetail(res.data.transaction);
    setDraft(draftFrom(res.data.transaction));
    const extra = [
      res.data.appliedToOthers ? `Also updated ${res.data.appliedToOthers} other ${res.data.appliedToOthers === 1 ? "transaction" : "transactions"} from ${res.data.transaction.merchantName}.` : null,
      res.data.learned && changes.categoryId ? `Harbour will use this category for ${res.data.transaction.merchantName} from now on.` : null,
    ].filter(Boolean);
    toast.success("Transaction updated", extra.length ? { description: extra.join(" ") } : undefined);
    router.refresh();
  };

  const remove = async () => {
    if (!detail) return;
    const res = await deleteTransactionAction({ id: detail.id });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Transaction deleted");
    setConfirmDelete(false);
    onClose();
    router.refresh();
  };

  const categoryChanged = !!detail && !!draft && draft.categoryId !== (detail.category?.id ?? "");

  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent width="md">
        <DrawerHeader>
          {detail ? (
            <div className="flex items-center gap-3">
              <CategoryIcon icon={detail.category?.icon} color={detail.category?.color} size="lg" />
              <div className="min-w-0">
                <DrawerTitle className="truncate text-base font-semibold">{detail.merchantName}</DrawerTitle>
                <DrawerDescription className="text-xs text-muted-foreground">
                  {f.date(detail.date, "long")} · {detail.account.name}
                  {detail.account.mask ? ` ••${detail.account.mask}` : ""}
                </DrawerDescription>
              </div>
            </div>
          ) : (
            <>
              <DrawerTitle className="text-base font-semibold">Transaction</DrawerTitle>
              <DrawerDescription className="sr-only">Loading transaction details</DrawerDescription>
            </>
          )}
        </DrawerHeader>
        <DrawerBody>
          {loadError ? (
            <FormError message={loadError} />
          ) : !detail || !draft ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className={cn("tabular text-3xl font-semibold tracking-tight", detail.amountCents > 0 && !detail.isTransfer && "text-positive")}>{f.money(detail.amountCents, { signed: detail.amountCents > 0 })}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.isPending ? <Badge variant="warning">Pending</Badge> : <Badge variant="neutral">Posted{detail.postedDate && detail.postedDate !== detail.date ? ` ${f.date(detail.postedDate, "monthDay")}` : ""}</Badge>}
                  {detail.isManual ? <Badge variant="outline">Added by you</Badge> : null}
                  {detail.isTransfer ? <Badge variant="info">Transfer</Badge> : null}
                  {detail.isRecurring ? <Badge variant="primary">Recurring</Badge> : null}
                  {detail.isExcluded ? <Badge variant="neutral">Excluded from reports</Badge> : null}
                </div>
                {detail.description && detail.description !== detail.merchantName ? <p className="mt-2 break-words text-xs text-muted-foreground">Bank description: {detail.description}</p> : null}
              </div>

              <FormError message={saveError} />

              <div className="space-y-3">
                <Field label="Category" hint={SOURCE_LABELS[detail.categorizedBy] + (detail.categorizedByLabel && detail.categorizedBy !== "USER" ? ` (${detail.categorizedByLabel})` : "")}>
                  <Select value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })} placeholder="Uncategorized">
                    <CategoryOptions categories={categories} direction={detail.amountCents > 0 ? "in" : "out"} />
                  </Select>
                </Field>
                {categoryChanged && draft.categoryId ? (
                  <div className="flex items-start gap-2">
                    <Checkbox id="apply-merchant" checked={draft.applyToMerchant} onCheckedChange={(c) => set({ applyToMerchant: c === true })} className="mt-0.5" />
                    <Label htmlFor="apply-merchant" className="font-normal leading-snug">
                      Also change other transactions from {detail.merchantName} that you haven&apos;t categorized yourself
                    </Label>
                  </div>
                ) : null}
                <Field label="Name">
                  <Input value={draft.merchantName} onChange={(e) => set({ merchantName: e.target.value })} maxLength={80} autoComplete="off" />
                </Field>
                {detail.isManual ? (
                  <>
                    <Segmented
                      aria-label="Money in or out"
                      className="w-full"
                      value={draft.direction}
                      onChange={(v) => set({ direction: v })}
                      options={[
                        { value: "out", label: "Money out" },
                        { value: "in", label: "Money in" },
                      ]}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Amount">
                        <CurrencyInput value={draft.amountCents} onChange={(c) => set({ amountCents: c })} currency={f.currency} locale={f.locale} />
                      </Field>
                      <Field label="Date">
                        <DatePicker value={draft.date} onChange={(d) => d && set({ date: d })} locale={f.locale} max={f.today} />
                      </Field>
                    </div>
                  </>
                ) : null}
                <Field label="Notes">
                  <Textarea rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} placeholder="Optional" />
                </Field>
                <Field label="Tags" hint="Separate tags with commas.">
                  <Input value={draft.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="e.g. Work, Reimbursable" autoComplete="off" />
                </Field>
              </div>

              <div className="divide-y divide-border rounded-xl border border-border">
                {[
                  { key: "isRecurring" as const, label: "Recurring", hint: "A regular charge or deposit, like rent or a subscription." },
                  { key: "isTransfer" as const, label: "Transfer between my accounts", hint: "Transfers don't count as spending or income." },
                  { key: "isExcluded" as const, label: "Exclude from budgets and reports", hint: "For one-offs you don't want skewing your numbers." },
                ].map((row) => (
                  <div key={row.key} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={`t-${row.key}`}>{row.label}</Label>
                      <p className="text-xs text-muted-foreground">{row.hint}</p>
                    </div>
                    <Switch id={`t-${row.key}`} checked={draft[row.key]} disabled={row.key === "isTransfer" && categoryChanged} onCheckedChange={(v) => set({ [row.key]: v } as Partial<Draft>)} />
                  </div>
                ))}
              </div>

              {detail.contributions.length ? (
                <section>
                  <h3 className="text-[13px] font-semibold">Linked to goals</h3>
                  <ul className="mt-1.5 space-y-1 text-[13px]">
                    {detail.contributions.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {CONTRIBUTION_LABELS[c.kind] ?? "Linked to"}{" "}
                          <Link href={`/goals/${c.goal.id}`} className="font-medium text-foreground hover:underline">
                            {c.goal.name}
                          </Link>
                        </span>
                        <span className="tabular font-medium">{f.money(c.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                  {detail.contributions.some((c) => c.kind === "PLANNED_ALLOCATION") ? <p className="mt-1 text-xs text-muted-foreground">Planned amounts are earmarked in Harbour only; no money was moved.</p> : null}
                </section>
              ) : null}

              {detail.automationRuns.length ? (
                <section>
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <Bot className="size-4 text-muted-foreground" aria-hidden /> Automations that ran
                  </h3>
                  <ul className="mt-1.5 space-y-1.5 text-[13px]">
                    {detail.automationRuns.map((r, i) => (
                      <li key={`${r.automation.id}:${i}`}>
                        <Link href={`/automations?id=${r.automation.id}`} className="font-medium hover:underline">
                          {r.automation.name}
                        </Link>
                        <span className="text-muted-foreground">
                          {" "}
                          · {formatDateTime(r.executedAt, f.timeZone, f.locale)}
                          {r.status !== "SUCCESS" ? ` · ${r.status.toLowerCase()}` : ""}
                        </span>
                        {r.summary ? <p className="text-xs text-muted-foreground">{r.summary}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {detail.categorizedBy === "AI" ? (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden /> This category was suggested automatically. Confirm it or pick another so Harbour learns.
                </p>
              ) : null}
            </div>
          )}
        </DrawerBody>
        {detail && draft ? (
          <DrawerFooter>
            {detail.isManual ? (
              <Button variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
            ) : null}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={save} loading={saving} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          </DrawerFooter>
        ) : null}
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this transaction?"
          description={detail?.account ? `It will be removed from ${detail.account.name}. This can't be undone.` : "This can't be undone."}
          confirmLabel="Delete"
          destructive
          onConfirm={remove}
        />
      </DrawerContent>
    </Drawer>
  );
}
