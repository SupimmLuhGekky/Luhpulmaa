"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, MoreHorizontal, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { CategoryIcon } from "@/components/shared/category-icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Field, FormError } from "@/components/shared/field";
import { cn } from "@/lib/utils";
import {
  createSubcategoryAction,
  deleteCategoryAction,
  deleteSubcategoryAction,
  reorderCategoriesAction,
  updateCategoryAction,
  updateSubcategoryAction,
} from "@/app/actions/settings";
import { CategoryDialog, KIND_LABELS, type CategoryKind, type EditableCategory } from "./category-dialog";

export interface CategoryRow extends EditableCategory {
  isHidden: boolean;
  transactionCount: number;
  subcategories: { id: string; name: string }[];
}

const KINDS: CategoryKind[] = ["EXPENSE", "INCOME", "TRANSFER"];

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-CA")} ${n === 1 ? one : many}`;
}

export function CategoriesManager({ categories: initial }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [categories, setCategories] = React.useState(initial);
  const [kind, setKind] = React.useState<CategoryKind>("EXPENSE");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<{ mode: "create" } | { mode: "edit"; category: CategoryRow } | null>(null);
  const [deleting, setDeleting] = React.useState<CategoryRow | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setCategories(initial), [initial]);

  const visible = categories.filter((c) => c.kind === kind);
  const counts = Object.fromEntries(KINDS.map((k) => [k, categories.filter((c) => c.kind === k).length])) as Record<CategoryKind, number>;

  const refresh = () => router.refresh();

  const move = async (cat: CategoryRow, delta: -1 | 1) => {
    const list = categories.filter((c) => c.kind === kind);
    const i = list.findIndex((c) => c.id === cat.id);
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    // Keep the global order grouped by type so every list in the app stays consistent.
    const next = KINDS.flatMap((k) => (k === kind ? reordered : categories.filter((c) => c.kind === k)));
    setCategories(next);
    const res = await reorderCategoriesAction({ ids: next.map((c) => c.id) });
    if (!res.ok) {
      toast.error(res.error.message);
      setCategories(categories);
      return;
    }
    refresh();
  };

  const toggleHidden = async (cat: CategoryRow) => {
    setBusy(true);
    const res = await updateCategoryAction({ id: cat.id, patch: { isHidden: !cat.isHidden } });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(cat.isHidden ? `${cat.name} is visible again` : `${cat.name} is hidden`, {
      description: cat.isHidden ? undefined : "It won't be offered when categorising. Existing transactions keep it.",
    });
    refresh();
  };

  const toggleExpanded = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          aria-label="Category type"
          value={kind}
          onChange={setKind}
          className="w-full sm:w-auto"
          options={KINDS.map((k) => ({ value: k, label: `${KIND_LABELS[k]} ${counts[k]}` }))}
        />
        <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
          <Plus /> New category
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState compact icon={Tags} title={`No ${KIND_LABELS[kind].toLowerCase()} categories`} description="Add one to start sorting these transactions." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visible.map((c, index) => {
            const open = expanded.has(c.id);
            return (
              <li key={c.id} className={cn(c.isHidden && "bg-subtle")}>
                <div className="flex items-center gap-2 px-2 py-2.5 sm:px-3">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => move(c, -1)}
                      disabled={index === 0}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      aria-label={`Move ${c.name} up`}
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(c, 1)}
                      disabled={index === visible.length - 1}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      aria-label={`Move ${c.name} down`}
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(c.id)}
                    aria-expanded={open}
                    aria-controls={`subs-${c.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-accent/50"
                  >
                    <CategoryIcon icon={c.icon} color={c.color} className={cn(c.isHidden && "opacity-50")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={cn("truncate text-sm font-medium", c.isHidden ? "text-muted-foreground" : "text-foreground")}>{c.name}</span>
                        {c.systemKey ? <Badge variant="outline">Built-in</Badge> : null}
                        {c.isHidden ? <Badge variant="neutral">Hidden</Badge> : null}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {plural(c.transactionCount, "transaction")} · {plural(c.subcategories.length, "subcategory", "subcategories")}
                      </span>
                    </span>
                    <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`} disabled={busy}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => setDialog({ mode: "edit", category: c })}>
                        <Pencil /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => toggleHidden(c)}>
                        {c.isHidden ? (
                          <>
                            <Eye /> Show
                          </>
                        ) : (
                          <>
                            <EyeOff /> Hide
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {c.systemKey ? (
                        <DropdownMenuLabel className="max-w-56 font-normal">Built-in categories can&apos;t be deleted. Hide it instead.</DropdownMenuLabel>
                      ) : (
                        <DropdownMenuItem destructive onSelect={() => setDeleting(c)}>
                          <Trash2 /> Delete…
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {open ? <Subcategories category={c} onChanged={refresh} /> : null}
              </li>
            );
          })}
        </ul>
      )}

      <CategoryDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        category={dialog?.mode === "edit" ? dialog.category : null}
        defaultKind={kind}
        onSaved={refresh}
      />
      <DeleteCategoryDialog category={deleting} categories={categories} onClose={() => setDeleting(null)} onDeleted={refresh} />
    </div>
  );
}

function Subcategories({ category, onChanged }: { category: CategoryRow; onChanged: () => void }) {
  const [name, setName] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    const res = await createSubcategoryAction({ categoryId: category.id, input: { name: trimmed } });
    setAdding(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setName("");
    onChanged();
  };

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const trimmed = editing.name.trim();
    if (!trimmed) return;
    setError(null);
    const res = await updateSubcategoryAction({ id: editing.id, input: { name: trimmed } });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setEditing(null);
    onChanged();
  };

  return (
    <div id={`subs-${category.id}`} className="border-t border-border bg-subtle/60 px-3 py-3 sm:pl-[4.25rem]">
      <FormError message={error} />
      {category.subcategories.length ? (
        <ul className="mb-2 space-y-1">
          {category.subcategories.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
              {editing?.id === s.id ? (
                <form onSubmit={rename} className="flex flex-1 items-center gap-2">
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                    maxLength={40}
                    autoFocus
                    aria-label={`New name for ${s.name}`}
                    className="h-8"
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                  />
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel renaming">
                    <X />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{s.name}</span>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing({ id: s.id, name: s.name })} aria-label={`Rename ${s.name}`}>
                    <Pencil />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => setRemoving(s)} aria-label={`Delete ${s.name}`}>
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 px-2 text-[13px] text-muted-foreground">No subcategories yet.</p>
      )}
      <form onSubmit={add} className="flex items-center gap-2 px-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={`Add a subcategory to ${category.name}`} aria-label={`New subcategory for ${category.name}`} className="h-8" />
        <Button type="submit" size="sm" variant="outline" loading={adding} disabled={!name.trim()}>
          Add
        </Button>
      </form>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete “${removing?.name ?? ""}”?`}
        description={`Transactions in it stay in ${category.name}; only the subcategory label is removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const res = await deleteSubcategoryAction({ id: removing.id });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success("Subcategory deleted");
          setRemoving(null);
          onChanged();
        }}
      />
    </div>
  );
}

function DeleteCategoryDialog({ category, categories, onClose, onDeleted }: { category: CategoryRow | null; categories: CategoryRow[]; onClose: () => void; onDeleted: () => void }) {
  const [target, setTarget] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    setTarget("");
    setError(null);
  }, [category]);
  if (!category) return null;
  const needsTarget = category.transactionCount > 0;
  const options = categories.filter((c) => c.id !== category.id && !c.isHidden);

  const confirm = async () => {
    if (needsTarget && !target) {
      setError("Choose where to move its transactions.");
      return;
    }
    setPending(true);
    const res = await deleteCategoryAction({ id: category.id, ...(needsTarget ? { reassignTo: target === "none" ? null : target } : {}) });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(`${category.name} deleted`);
    onClose();
    onDeleted();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader>
          <DialogTitle>Delete {category.name}?</DialogTitle>
          <DialogDescription>
            {needsTarget
              ? `${plural(category.transactionCount, "transaction")} use this category. Choose where they should go first.`
              : "No transactions use it. Its subcategories and budget lines are removed too."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <FormError message={error} />
          {needsTarget ? (
            <Field label="Move its transactions to">
              <Select value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Choose a category…">
                {KINDS.map((k) => {
                  const group = options.filter((o) => o.kind === k);
                  return group.length ? (
                    <optgroup key={k} label={KIND_LABELS[k]}>
                      {group.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
                <option value="none">Leave them uncategorized</option>
              </Select>
            </Field>
          ) : null}
          {needsTarget ? <p className="text-xs text-muted-foreground">Budget lines for {category.name} are removed. This can&apos;t be undone.</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} loading={pending}>
            Delete category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
