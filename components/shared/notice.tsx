import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
  info: { cls: "border-info/25 bg-info-soft text-info", Icon: Info },
  warning: { cls: "border-warning/25 bg-warning-soft text-warning", Icon: AlertTriangle },
  danger: { cls: "border-danger/25 bg-danger-soft text-danger", Icon: XCircle },
  positive: { cls: "border-positive/25 bg-positive-soft text-positive", Icon: CheckCircle2 },
  neutral: { cls: "border-border bg-subtle text-muted-foreground", Icon: Info },
} as const;

/** Inline callout for estimates, disclaimers and warnings. */
export function Notice({ tone = "info", title, children, className, action }: { tone?: keyof typeof tones; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const { cls, Icon } = tones[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]", cls, className)} role={tone === "danger" ? "alert" : "note"}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-foreground/90">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "text-muted-foreground")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
