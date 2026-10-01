import { Skeleton } from "@/components/ui/skeleton";

export default function NetWorthLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading net worth">
      <div className="flex items-end justify-between gap-3 pb-1">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="hidden h-9 w-40 rounded-lg sm:block" />
      </div>
      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-11 w-56" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
              <Skeleton className="h-7 w-56 rounded-lg" />
            </div>
            <Skeleton className="mt-4 h-[280px] w-full" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="mt-6 h-24 w-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
