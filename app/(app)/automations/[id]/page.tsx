import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { isEnabled } from "@/lib/flags";
import { AppError } from "@/lib/api/errors";
import { ACTION_INFO, TRIGGER_INFO } from "@/lib/automation/describe";
import { automationOptions } from "@/lib/automation/options";
import { isTransactionTrigger } from "@/lib/automation/schemas";
import { getAutomation, listRuns } from "@/lib/automation/service";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { AutomationBuilder } from "@/components/automations/automation-builder";
import { AutomationHeaderActions, AutomationTabs } from "@/components/automations/automation-detail";
import { valuesFromAutomation } from "@/components/automations/builder-values";
import { RunHistory } from "@/components/automations/run-history";

export const metadata: Metadata = { title: "Automation" };

async function load(userId: string, id: string) {
  try {
    return await getAutomation(userId, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export default async function AutomationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  if (!isEnabled("ENABLE_AUTOMATIONS")) notFound();
  const user = await requireOnboardedUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { tab } = await searchParams;
  const [automation, options, runs] = await Promise.all([load(user.id, id), automationOptions(user.id), listRuns(user.id, { automationId: id, take: 20 })]);
  const plansMoney = automation.actions.some((a) => ACTION_INFO[a.type].plansMoney);

  return (
    <div className="space-y-4">
      <Link href="/automations" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Automations
      </Link>
      <PageHeader
        title={automation.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{TRIGGER_INFO[automation.trigger].label}</span>
            {plansMoney ? <Badge variant="info">Plans money · nothing moves</Badge> : null}
          </span>
        }
        actions={
          <AutomationHeaderActions
            automation={{ id: automation.id, name: automation.name, isActive: automation.isActive, transactionTrigger: isTransactionTrigger(automation.trigger), plansMoney }}
          />
        }
      />
      <AutomationTabs
        initialTab={tab === "history" ? "history" : "rule"}
        runCount={automation.executionCount}
        rule={<AutomationBuilder automationId={automation.id} initial={valuesFromAutomation(automation)} options={options} />}
        history={
          <div className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
            <RunHistory initial={runs} automationId={automation.id} emptyText="Each time this automation does something, it's listed here with what it changed." />
          </div>
        }
      />
    </div>
  );
}
