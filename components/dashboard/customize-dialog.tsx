"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DASHBOARD_WIDGETS, type DashboardLayout } from "@/lib/dashboard/layout";
import { saveDashboardLayoutAction } from "@/app/actions/dashboard";

const labels = Object.fromEntries(DASHBOARD_WIDGETS.map((w) => [w.id, w.label])) as Record<string, string>;

/** Show, hide and reorder dashboard widgets. Saved to the user's profile so it follows them across devices. */
export function CustomizeDashboard({ layout, customized }: { layout: DashboardLayout; customized: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(layout.widgets);
  const [saving, setSaving] = React.useState(false);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (open) setDraft(layout.widgets);
  }, [open, layout.widgets]);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    setDraft((list) => {
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    // Keep keyboard focus on the same control after the row moves.
    requestAnimationFrame(() => {
      const row = listRef.current?.children[target];
      (row?.querySelector<HTMLButtonElement>(`[data-move="${delta}"]:not(:disabled)`) ?? row?.querySelector<HTMLButtonElement>("[data-move]:not(:disabled)"))?.focus();
    });
  };

  const save = async (next: DashboardLayout | null) => {
    setSaving(true);
    const res = await saveDashboardLayoutAction({ layout: next });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(next ? "Dashboard saved" : "Dashboard reset to the default layout");
    setOpen(false);
    router.refresh();
  };

  const visibleCount = draft.filter((w) => w.visible).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LayoutGrid /> Customize
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Customize your dashboard</DialogTitle>
          <DialogDescription>Choose which cards to show and the order they appear in.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul ref={listRef} className="divide-y divide-border rounded-xl border border-border">
            {draft.map((w, i) => {
              const id = `widget-${w.id}`;
              return (
                <li key={w.id} className="flex items-center gap-3 px-3 py-2">
                  <Switch
                    id={id}
                    checked={w.visible}
                    onCheckedChange={(visible) => setDraft((list) => list.map((x) => (x.id === w.id ? { ...x, visible } : x)))}
                  />
                  <label htmlFor={id} className="min-w-0 flex-1 truncate text-sm">
                    {labels[w.id]}
                  </label>
                  <Button variant="ghost" size="icon-sm" data-move="-1" aria-label={`Move ${labels[w.id]} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" data-move="1" aria-label={`Move ${labels[w.id]} down`} disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                </li>
              );
            })}
          </ul>
          {visibleCount === 0 ? <p className="mt-2 text-xs text-warning">All cards are hidden. Your dashboard will only show quick actions.</p> : null}
        </DialogBody>
        <DialogFooter>
          {customized ? (
            <Button variant="ghost" className="sm:mr-auto" disabled={saving} onClick={() => save(null)}>
              Reset to default
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => save({ widgets: draft })}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
