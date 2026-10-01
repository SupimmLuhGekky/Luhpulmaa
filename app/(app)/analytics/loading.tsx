import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading analytics">
      <div className="space-y-2 pb-1">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <Skeleton className="h-9 w-full rounded-lg sm:w-80" />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Skeleton className="h-9 rounded-lg sm:w-44" />
          <Skeleton className="h-9 rounded-lg sm:w-44" />
        </div>
      </div>
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
        <Skeleton className="h-[25rem] rounded-xl" />
        <Skeleton className="h-[25rem] rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-80 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
