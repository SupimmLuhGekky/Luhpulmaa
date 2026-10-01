"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { CategoryIcon, iconFor } from "@/components/shared/category-icon";
import { Field, FormError } from "@/components/shared/field";
import { CATEGORY_COLOR_CHOICES, CATEGORY_ICON_CHOICES } from "@/lib/categories/defaults";
import { cn } from "@/lib/utils";
import { createCategoryAction, updateCategoryAction } from "@/app/actions/settings";

export type CategoryKind = "EXPENSE" | "INCOME" | "TRANSFER";

export interface EditableCategory {
  id: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  systemKey: string | null;
}

export const KIND_LABELS: Record<CategoryKind, string> = { EXPENSE: "Spending", INCOME: "Income", TRANSFER: "Transfers" };

export function CategoryDialog({
  open,
  onOpenChange,
  category,
  defaultKind = "EXPENSE",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  category?: EditableCategory | null;
  defaultKind?: CategoryKind;
  onSaved: () => void;
}) {
  const editing = Boolean(category);
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<CategoryKind>(defaultKind);
  const [icon, setIcon] = React.useState<string>("circle");
  const [color, setColor] = React.useState<string>(CATEGORY_COLOR_CHOICES[0]);
  const [error, setError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | undefined>();
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setKind(category?.kind ?? defaultKind);
    setIcon(category?.icon ?? "circle");
    setColor(category?.color ?? CATEGORY_COLOR_CHOICES[0]);
    setError(null);
    setNameError(undefined);
  }, [open, category, defaultKind]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give the category a name");
      return;
    }
    if (trimmed.length > 40) {
      setNameError("Use at most 40 characters");
      return;
    }
    setSaving(true);
    setError(null);
    setNameError(undefined);
    const res = category
      ? await updateCategoryAction({ id: category.id, patch: { name: trimmed, icon, color, ...(category.systemKey ? {} : { kind }) } })
      : await createCategoryAction({ name: trimmed, kind, icon, color });
    setSaving(false);
    if (!res.ok) {
      // A name problem (say, a duplicate) belongs under the name field.
      const nameProblem = res.error.fieldErrors?.name?.[0];
      if (nameProblem) setNameError(nameProblem);
      else setError(res.error.message);
      return;
    }
    toast.success(category ? "Category updated" : `“${trimmed}” added`);
    onOpenChange(false);
    onSaved();
  };

  const icons = CATEGORY_ICON_CHOICES.includes(icon as (typeof CATEGORY_ICON_CHOICES)[number]) ? CATEGORY_ICON_CHOICES : [icon, ...CATEGORY_ICON_CHOICES];

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent size="md">
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>{editing && category?.systemKey ? "Built-in category: you can rename it and change its look." : "Name it, then pick an icon and a colour."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <div className="flex items-center gap-3 rounded-lg border border-border bg-subtle p-3">
              <CategoryIcon icon={icon} color={color} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{name.trim() || "Category name"}</p>
                <p className="text-xs text-muted-foreground">{KIND_LABELS[kind]}</p>
              </div>
            </div>
            <Field label="Name" error={nameError} required>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(undefined);
                }}
                maxLength={40}
                autoFocus
                placeholder="e.g. Pets"
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] font-medium leading-none text-foreground">Type</p>
              <Segmented
                aria-label="Category type"
                value={kind}
                onChange={(v) => setKind(v)}
                className="w-full sm:w-auto"
                options={(Object.keys(KIND_LABELS) as CategoryKind[]).map((k) => ({ value: k, label: KIND_LABELS[k], disabled: Boolean(category?.systemKey) && k !== category?.kind }))}
              />
              {kind === "TRANSFER" ? <p className="text-xs text-muted-foreground">Transactions in transfer categories are left out of spending and income.</p> : null}
            </div>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-foreground">Icon</legend>
              <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
                {icons.map((iconName) => {
                  const Icon = iconFor(iconName);
                  const selected = icon === iconName;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => setIcon(iconName)}
                      aria-pressed={selected}
                      aria-label={iconName.replace(/-/g, " ")}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        selected ? "border-primary bg-primary-soft text-primary" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-foreground">Colour</legend>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_COLOR_CHOICES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-pressed={color === c}
                    aria-label={`Colour ${c}`}
                    className="flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-popover transition-shadow focus-visible:outline-2 focus-visible:outline-ring aria-pressed:ring-2 aria-pressed:ring-foreground/60"
                    style={{ backgroundColor: c }}
                  >
                    {color === c ? <Check className="size-3.5 text-white" aria-hidden /> : null}
                  </button>
                ))}
              </div>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save" : "Add category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
