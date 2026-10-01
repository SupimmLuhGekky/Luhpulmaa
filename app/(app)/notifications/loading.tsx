import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4" aria-busy="true" aria-label="Loading notifications">
      <div className="space-y-2 pb-1">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-lg" />
      </div>
      <div className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3 px-4 py-4">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
