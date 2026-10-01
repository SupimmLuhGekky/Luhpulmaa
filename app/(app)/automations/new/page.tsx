import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { isEnabled } from "@/lib/flags";
import { automationOptions } from "@/lib/automation/options";
import { AUTOMATION_TEMPLATES } from "@/lib/automation/service";
import { PageHeader } from "@/components/shared/page-header";
import { AutomationBuilder } from "@/components/automations/automation-builder";
import { emptyBuilderValues, valuesFromTemplate } from "@/components/automations/builder-values";

export const metadata: Metadata = { title: "New automation" };

export default async function NewAutomationPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  if (!isEnabled("ENABLE_AUTOMATIONS")) notFound();
  const user = await requireOnboardedUser();
  const { template: templateKey } = await searchParams;
  const options = await automationOptions(user.id);
  const template = AUTOMATION_TEMPLATES.find((t) => t.key === templateKey);
  const initial = template ? valuesFromTemplate(template, options) : emptyBuilderValues();

  return (
    <div className="space-y-4">
      <Link href="/automations" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Automations
      </Link>
      <PageHeader title="New automation" description="Choose what starts it, when it should apply and what it does. Preview it on your last 90 days before saving." />
      {!template ? (
        <nav aria-label="Templates" className="-mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Or start from:</span>
          {AUTOMATION_TEMPLATES.map((t) => (
            <Link
              key={t.key}
              href={`/automations/new?template=${t.key}`}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <AutomationBuilder key={templateKey ?? "blank"} initial={initial} options={options} templateName={template?.name} />
    </div>
  );
}
