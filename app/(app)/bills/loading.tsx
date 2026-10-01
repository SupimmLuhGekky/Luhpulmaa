import { Skeleton } from "@/components/ui/skeleton";

export default function BillsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading bills">
      <div className="flex items-end justify-between gap-3 pb-1">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-9 w-28 rounded-lg sm:block" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Skeleton className="col-span-2 h-52 rounded-xl lg:col-span-1" />
        <Skeleton className="h-36 rounded-xl sm:h-52" />
        <Skeleton className="h-36 rounded-xl sm:h-52" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-7 w-44 rounded-lg" />
        </div>
        <div className="grid gap-px p-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-80 rounded-lg sm:h-[28rem]" />
          <div className="hidden space-y-3 p-4 lg:block">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
