import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AccountLoading() {
  return (
    <div aria-busy="true" aria-label="Loading account">
      <Skeleton className="mb-4 h-4 w-20" />
      <div className="flex flex-col gap-3 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-9 w-44" />
            <Skeleton className="mt-2 h-3 w-32" />
            <Skeleton className="mt-6 h-[220px] w-full" />
          </Card>
          <Card className="space-y-4 p-5">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-12 w-full" />
          </Card>
          <Card className="space-y-4 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
        </div>
      </div>
    </div>
  );
}
