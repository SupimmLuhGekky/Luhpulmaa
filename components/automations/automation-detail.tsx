"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, Play, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteAutomationAction, setAutomationActiveAction } from "@/app/actions/automations";
import { ApplyRecentDialog } from "./apply-recent-dialog";

/** On/off switch, "run on past transactions" and delete for one automation. */
export function AutomationHeaderActions({ automation }: { automation: { id: string; name: string; isActive: boolean; transactionTrigger: boolean; plansMoney: boolean } }) {
  const router = useRouter();
  const [on, setOn] = React.useState(automation.isActive);
  const [pending, setPending] = React.useState(false);
  const [applyOpen, setApplyOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  React.useEffect(() => setOn(automation.isActive), [automation.isActive]);

  const toggle = async (value: boolean) => {
    setOn(value);
    setPending(true);
    const res = await setAutomationActiveAction({ id: automation.id, isActive: value });
    setPending(false);
    if (!res.ok) {
      setOn(!value);
      toast.error(res.error.message);
      return;
    }
    toast.success(value ? "Automation turned on" : "Automation turned off");
    router.refresh();
  };

  return (
    <>
      <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground shadow-soft" htmlFor="header-active">
        <Switch id="header-active" checked={on} onCheckedChange={toggle} disabled={pending} />
        {on ? "On" : "Off"}
      </label>
      {automation.transactionTrigger ? (
        <Button variant="outline" size="sm" onClick={() => setApplyOpen(true)} disabled={!on}>
          <Play /> Run on past transactions
        </Button>
      ) : null}
      <Button variant="ghost" size="icon-sm" onClick={() => setDeleteOpen(true)} aria-label={`Delete “${automation.name}”`}>
        <Trash2 />
      </Button>
      <ApplyRecentDialog open={applyOpen} onOpenChange={setApplyOpen} automation={{ id: automation.id, name: automation.name, isActive: on, plansMoney: automation.plansMoney }} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${automation.name}”?`}
        description="It stops running and its run history is deleted. Changes it already made to transactions, and planned allocations it recorded on goals, stay as they are."
        confirmLabel="Delete automation"
        destructive
        onConfirm={async () => {
          const res = await deleteAutomationAction({ id: automation.id });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success("Automation deleted");
          setDeleteOpen(false);
          router.push("/automations");
        }}
      />
    </>
  );
}

/** "Rule" / "History" tabs, kept in the URL (?tab=history) so links can open the history directly. */
export function AutomationTabs({ initialTab, runCount, rule, history }: { initialTab: "rule" | "history"; runCount: number; rule: React.ReactNode; history: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = React.useState(initialTab);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        const next = v === "history" ? "history" : "rule";
        setTab(next);
        router.replace(next === "history" ? `${pathname}?tab=history` : pathname, { scroll: false });
      }}
    >
      <TabsList>
        <TabsTrigger value="rule">
          <SlidersHorizontal /> Rule
        </TabsTrigger>
        <TabsTrigger value="history">
          <History /> History{runCount ? ` · ${runCount}` : ""}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="rule" forceMount hidden={tab !== "rule"}>
        {rule}
      </TabsContent>
      <TabsContent value="history">{history}</TabsContent>
    </Tabs>
  );
}
