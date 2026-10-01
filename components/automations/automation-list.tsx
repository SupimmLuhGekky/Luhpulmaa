"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, MoreHorizontal, Pencil, Play, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useFormat } from "@/components/providers/format-provider";
import { ACTION_INFO } from "@/lib/automation/describe";
import { isTransactionTrigger } from "@/lib/automation/schemas";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { deleteAutomationAction, setAutomationActiveAction } from "@/app/actions/automations";
import type { AutomationDTO } from "@/lib/automation/service";
import { ApplyRecentDialog } from "./apply-recent-dialog";
import { AutomationSentence, TRIGGER_ICONS, useDescribeContext, type AutomationOptions } from "./automation-shared";

export function plansMoney(a: Pick<AutomationDTO, "actions">) {
  return a.actions.some((x) => ACTION_INFO[x.type]?.plansMoney);
}

export function AutomationList({ automations, options }: { automations: AutomationDTO[]; options: AutomationOptions }) {
  const router = useRouter();
  const fmt = useFormat();
  const ctx = useDescribeContext(options);
  const [active, setActive] = React.useState<Record<string, boolean>>(() => Object.fromEntries(automations.map((a) => [a.id, a.isActive])));
  const [pending, setPending] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<AutomationDTO | null>(null);
  const [applying, setApplying] = React.useState<AutomationDTO | null>(null);

  React.useEffect(() => setActive(Object.fromEntries(automations.map((a) => [a.id, a.isActive]))), [automations]);

  const toggle = async (a: AutomationDTO, value: boolean) => {
    setPending(a.id);
    setActive((s) => ({ ...s, [a.id]: value }));
    const res = await setAutomationActiveAction({ id: a.id, isActive: value });
    setPending(null);
    if (!res.ok) {
      setActive((s) => ({ ...s, [a.id]: !value }));
      toast.error(res.error.message);
      return;
    }
    toast.success(value ? `“${a.name}” is on` : `“${a.name}” is off`, { description: value ? undefined : "It won't run until you turn it back on." });
    router.refresh();
  };

  return (
    <>
      <ul className="space-y-3">
        {automations.map((a) => {
          const Icon = TRIGGER_ICONS[a.trigger];
          const on = active[a.id] ?? a.isActive;
          const plans = plansMoney(a);
          return (
            <li key={a.id} className={cn("rounded-xl border border-border bg-card p-4 shadow-soft transition-opacity", !on && "opacity-80")}>
              <div className="flex items-start gap-3">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", on ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground")} aria-hidden>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/automations/${a.id}`} className="min-w-0 break-words text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                      {a.name}
                    </Link>
                    {!on ? <Badge variant="neutral">Off</Badge> : null}
                    {plans ? <Badge variant="info">Plans money · nothing moves</Badge> : null}
                  </div>
                  {a.description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{a.description}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch checked={on} onCheckedChange={(v) => toggle(a, v)} disabled={pending === a.id} aria-label={`${on ? "Turn off" : "Turn on"} “${a.name}”`} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`More actions for “${a.name}”`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/automations/${a.id}`}>
                          <Pencil /> Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/automations/${a.id}?tab=history`}>
                          <History /> Run history
                        </Link>
                      </DropdownMenuItem>
                      {isTransactionTrigger(a.trigger) ? (
                        <DropdownMenuItem onSelect={() => setApplying(a)} disabled={!on}>
                          <Play /> Run on past transactions…
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setRemoving(a)}>
                        <Trash2 /> Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <AutomationSentence automation={a} ctx={ctx} compact className="mt-3 rounded-lg bg-subtle px-3 py-2.5" />
              <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden />
                {a.executionCount ? (
                  <span>
                    Ran {a.executionCount.toLocaleString(fmt.locale)} {a.executionCount === 1 ? "time" : "times"}
                    {a.lastExecutedAt ? (
                      <>
                        {" · last "}
                        <time dateTime={a.lastExecutedAt} suppressHydrationWarning>
                          {formatDateTime(a.lastExecutedAt, fmt.timeZone, fmt.locale)}
                        </time>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span>Hasn&apos;t run yet</span>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete “${removing?.name ?? ""}”?`}
        description="It stops running and its run history is deleted. Changes it already made to transactions, and planned allocations it recorded on goals, stay as they are."
        confirmLabel="Delete automation"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const res = await deleteAutomationAction({ id: removing.id });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success("Automation deleted");
          setRemoving(null);
          router.refresh();
        }}
      />
      <ApplyRecentDialog
        open={applying !== null}
        onOpenChange={(o) => !o && setApplying(null)}
        automation={applying ? { id: applying.id, name: applying.name, isActive: active[applying.id] ?? applying.isActive, plansMoney: plansMoney(applying) } : null}
      />
    </>
  );
}
