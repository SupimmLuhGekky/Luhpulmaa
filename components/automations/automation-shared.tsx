"use client";

import * as React from "react";
import { ArrowDownToLine, BellRing, CalendarDays, CalendarRange, PiggyBank, ReceiptText, type LucideIcon } from "lucide-react";
import { useFormat } from "@/components/providers/format-provider";
import { describeAction, describeCondition, describeTrigger, type DescribeContext } from "@/lib/automation/describe";
import type { ActionType, ConditionField, ConditionOperator, Trigger, TriggerConfig } from "@/lib/automation/schemas";
import { cn } from "@/lib/utils";
import type { AutomationOptions } from "./builder-values";

export type { AutomationOptions };

/** The parts of an automation needed to describe it. */
export interface AutomationShape {
  trigger: Trigger;
  triggerConfig: TriggerConfig;
  conditionLogic: "ALL" | "ANY";
  conditions: { field: ConditionField; operator: ConditionOperator; value: string }[];
  actions: { type: ActionType; config: Record<string, unknown> }[];
}

export const TRIGGER_ICONS: Record<Trigger, LucideIcon> = {
  TRANSACTION_CREATED: ReceiptText,
  INCOME_RECEIVED: ArrowDownToLine,
  SCHEDULE_MONTHLY: CalendarDays,
  SCHEDULE_WEEKLY: CalendarRange,
  SUBSCRIPTION_DETECTED: BellRing,
  BUDGET_THRESHOLD: PiggyBank,
};

export function useDescribeContext(options: AutomationOptions): DescribeContext {
  const fmt = useFormat();
  return React.useMemo(() => {
    const cats = new Map(options.categories.map((c) => [c.id, c.name]));
    const accounts = new Map(options.accounts.map((a) => [a.id, a.name]));
    const goals = new Map(options.goals.map((g) => [g.id, g.name]));
    return {
      categoryName: (id: string) => cats.get(id),
      accountName: (id: string) => accounts.get(id),
      goalName: (id: string) => goals.get(id),
      money: (cents: number) => fmt.money(cents, { hideZeroCents: true }),
      locale: fmt.locale,
    };
  }, [options, fmt]);
}

/** "Add the note" → "add the note" when it follows "then"/"and"/"or". */
function continuation(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** WHEN / IF / THEN in plain language. */
export function AutomationSentence({ automation, ctx, className, compact }: { automation: AutomationShape; ctx: DescribeContext; className?: string; compact?: boolean }) {
  const joiner = automation.conditionLogic === "ANY" ? "or" : "and";
  const rows: { label: string; items: string[]; join?: string }[] = [{ label: "When", items: [describeTrigger(automation.trigger, automation.triggerConfig, ctx)] }];
  if (automation.conditions.length) rows.push({ label: "If", items: automation.conditions.map((c) => describeCondition(c, ctx)), join: joiner });
  rows.push({ label: "Then", items: automation.actions.length ? automation.actions.map((a) => describeAction(a, automation.trigger, ctx)) : ["Nothing yet"], join: "then" });
  return (
    <dl className={cn("grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[13px]", className)}>
      {rows.map((r) => (
        <React.Fragment key={r.label}>
          <dt className="pt-px text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 text-foreground">
            {compact || r.items.length === 1 ? (
              r.items.map((item, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? <span className="text-muted-foreground">{r.join === "then" ? ", then " : ` ${r.join} `}</span> : null}
                  <span className="break-words">{i > 0 ? continuation(item) : item}</span>
                </React.Fragment>
              ))
            ) : (
              <ol className="space-y-1">
                {r.items.map((item, i) => (
                  <li key={i} className="break-words">
                    {i > 0 ? <span className="mr-1 text-muted-foreground">{r.join === "then" ? "then" : r.join}</span> : null}
                    {i > 0 ? continuation(item) : item}
                  </li>
                ))}
              </ol>
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
