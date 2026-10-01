import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Workflow } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { isEnabled } from "@/lib/flags";
import { ACTION_INFO } from "@/lib/automation/describe";
import { automationOptions } from "@/lib/automation/options";
import { AUTOMATION_TEMPLATES, listAutomations, listRuns } from "@/lib/automation/service";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { AutomationList } from "@/components/automations/automation-list";
import { RunHistory } from "@/components/automations/run-history";
import { TemplateGrid, type TemplateCard } from "@/components/automations/template-grid";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  if (!isEnabled("ENABLE_AUTOMATIONS")) notFound();
  const user = await requireOnboardedUser();
  const [automations, options, runs] = await Promise.all([listAutomations(user.id), automationOptions(user.id), listRuns(user.id, { take: 8 })]);
  const templates: TemplateCard[] = AUTOMATION_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    trigger: t.trigger,
    plansMoney: t.actions.some((a) => ACTION_INFO[a.type].plansMoney),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description="Rules that sort transactions, remind you of things and plan money for your goals. They never move money."
        actions={
          <Button asChild>
            <Link href="/automations/new">
              <Plus /> New automation
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-8">
          {automations.length ? (
            <section aria-labelledby="yours-title" className="space-y-3">
              <h2 id="yours-title" className="text-sm font-semibold text-foreground">
                Your automations <span className="font-normal text-muted-foreground">· {automations.filter((a) => a.isActive).length} on</span>
              </h2>
              <AutomationList automations={automations} options={options} />
            </section>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card">
              <EmptyState
                icon={Workflow}
                title="No automations yet"
                description="Automations categorise and tag transactions as they arrive, remind you about things and plan money for goals. Start from scratch or from a template below."
                action={
                  <Button asChild size="sm">
                    <Link href="/automations/new">
                      <Plus /> Create one
                    </Link>
                  </Button>
                }
              />
            </div>
          )}
          <section aria-labelledby="templates-title" className="space-y-3">
            <div>
              <h2 id="templates-title" className="text-sm font-semibold text-foreground">
                Start from a template
              </h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">You can review and change everything before saving.</p>
            </div>
            <TemplateGrid templates={templates} />
          </section>
        </div>
        <aside aria-labelledby="activity-title" className="rounded-xl border border-border bg-card p-4 shadow-soft lg:sticky lg:top-20">
          <h2 id="activity-title" className="mb-3 text-sm font-semibold text-foreground">
            Recent activity
          </h2>
          <RunHistory initial={runs} showAutomation emptyText="When an automation does something, it shows up here." />
        </aside>
      </div>
    </div>
  );
}
