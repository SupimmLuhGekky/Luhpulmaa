import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardHeading } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Card frame shared by every dashboard widget. */
export function WidgetCard({ title, description, href, linkLabel = "View", className, children }: { title: string; description?: React.ReactNode; href?: string; linkLabel?: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeading
        title={title}
        description={description}
        action={
          href ? (
            <Link href={href} className="inline-flex items-center gap-0.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              {linkLabel}
              <ChevronRight className="size-3.5" aria-hidden />
              <span className="sr-only">: {title}</span>
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">{children}</div>
    </Card>
  );
}

export function WidgetSkeleton({ className, tall }: { className?: string; tall?: boolean }) {
  return (
    <Card className={cn("p-5", className)} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-40" />
      <Skeleton className={cn("mt-4 w-full", tall ? "h-40" : "h-16")} />
    </Card>
  );
}

/** Small "nothing here yet" panel inside a widget. */
export function WidgetEmpty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 rounded-lg border border-dashed border-border bg-subtle px-4 py-5 text-[13px] text-muted-foreground">
      <p>{children}</p>
      {action}
    </div>
  );
}
