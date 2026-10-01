"use client";

import * as React from "react";
import { Controller } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type RenderFn = (args: unknown) => React.ReactNode;

/**
 * Accessible form field: wires the label, hint and error to the control through
 * `htmlFor`/`aria-describedby`/`aria-invalid`. The single child must accept an id, or be a
 * react-hook-form `<Controller>` whose `render` returns an element that accepts one.
 */
export function Field({ label, hint, error, children, className, required, id: idProp }: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactElement<Record<string, unknown>>;
  className?: string;
  required?: boolean;
  id?: string;
}) {
  const auto = React.useId();
  const id = idProp ?? (children.props.id as string | undefined) ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-danger" aria-hidden> *</span> : null}
      </Label>
      {wire(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Passes the control props to the child, reaching through a `<Controller>` to what it renders. */
function wire(child: React.ReactElement<Record<string, unknown>>, control: Record<string, unknown>) {
  if (child.type === Controller && typeof child.props.render === "function") {
    const render = child.props.render as RenderFn;
    return React.cloneElement(child, {
      render: (args: unknown) => {
        const rendered = render(args);
        return React.isValidElement<Record<string, unknown>>(rendered) ? React.cloneElement(rendered, control) : rendered;
      },
    });
  }
  return React.cloneElement(child, control);
}

/** Form-level error banner. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
      {message}
    </div>
  );
}
