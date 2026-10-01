import * as React from "react";
import { cn } from "@/lib/utils";

/** Title block of a settings page (an h1: on phones each section is its own page). */
export function SettingsPageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A card-like group of related settings with a heading. */
export function SettingsSection({
  title,
  description,
  action,
  children,
  footer,
  className,
  id,
  tone,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  id?: string;
  tone?: "danger";
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("rounded-xl border bg-card text-card-foreground shadow-soft", tone === "danger" ? "border-danger/30" : "border-border", className)}>
      <div className="flex flex-col gap-3 p-5 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={headingId} className={cn("text-[15px] font-semibold tracking-tight", tone === "danger" ? "text-danger" : "text-foreground")}>
            {title}
          </h2>
          {description ? <div className="mt-1 text-[13px] text-muted-foreground">{description}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="px-5 pb-5">{children}</div> : null}
      {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
    </section>
  );
}

/**
 * One setting: label and explanation on the left, its control on the right. On phones the
 * control drops below the label, unless `inline` (for small controls such as switches).
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
  inline,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
  inline?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex py-3.5 first:pt-0 last:pb-0",
        inline ? "flex-row items-center justify-between gap-4 sm:gap-6" : "flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium text-foreground">{label}</p>
        )}
        {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Divider-separated stack of SettingRows. */
export function SettingRows({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border", className)}>{children}</div>;
}
