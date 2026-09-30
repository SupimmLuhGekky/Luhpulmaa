"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Friendly error panel used by route error boundaries. Never shows internal details. */
export function ErrorState({ title = "Something went wrong", message = "We couldn't load this page. Your data is safe — please try again.", onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      ) : null}
    </div>
  );
}
