import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TRIGGER_INFO } from "@/lib/automation/describe";
import type { Trigger } from "@/lib/automation/schemas";
import { cn } from "@/lib/utils";

export interface TemplateCard {
  key: string;
  name: string;
  description: string;
  trigger: Trigger;
  plansMoney: boolean;
}

/** Ready-made recipes; each opens the builder pre-filled so the person can review before saving. */
export function TemplateGrid({ templates, className }: { templates: TemplateCard[]; className?: string }) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {templates.map((t) => (
        <li key={t.key}>
          <Link
            href={`/automations/new?template=${t.key}`}
            className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-soft transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{TRIGGER_INFO[t.trigger].label}</span>
            <span className="mt-1 text-sm font-semibold text-foreground">{t.name}</span>
            <span className="mt-0.5 flex-1 text-[13px] text-muted-foreground">{t.description}</span>
            <span className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{t.plansMoney ? "Planned allocations only" : ""}</span>
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                Use template <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
