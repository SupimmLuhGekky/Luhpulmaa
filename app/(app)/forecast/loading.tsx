import { Skeleton } from "@/components/ui/skeleton";

export default function ForecastLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading cash flow">
      <div className="space-y-2 pb-1">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Skeleton className="h-[26rem] rounded-xl" />
        <Skeleton className="h-[26rem] rounded-xl" />
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-7 w-64 rounded-lg" />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
        <Skeleton className="mt-6 h-[280px] w-full" />
      </div>
    </div>
  );
}
