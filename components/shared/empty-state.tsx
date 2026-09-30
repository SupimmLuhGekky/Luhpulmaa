import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, description, action, className, compact }: { icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      {Icon ? (
        <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
      ) : null}
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? <p className="mt-1 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
