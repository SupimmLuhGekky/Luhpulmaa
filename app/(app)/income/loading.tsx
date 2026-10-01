import { Skeleton } from "@/components/ui/skeleton";

export default function IncomeLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading your income">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <Skeleton className="col-span-2 h-24 rounded-xl xl:col-span-1" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-xl lg:col-span-2" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
