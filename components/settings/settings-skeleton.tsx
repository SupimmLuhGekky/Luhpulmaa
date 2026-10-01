import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for a settings page while it loads: a title and a couple of sections. */
export function SettingsSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading settings">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2 h-3.5 w-full max-w-md" />
          <div className="mt-5 space-y-4">
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} className="flex items-center justify-between gap-4">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-full max-w-xs" />
                </div>
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
