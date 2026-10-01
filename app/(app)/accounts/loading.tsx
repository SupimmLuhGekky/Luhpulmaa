import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AccountsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading accounts">
      <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <Card className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
        <Skeleton className="col-span-2 h-14 sm:col-span-1" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {[3, 2].map((rows, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-32" />
              <div className="mt-4 space-y-4">
                {Array.from({ length: rows }, (_, j) => (
                  <div key={j} className="flex items-center gap-3">
                    <Skeleton className="size-9 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40 max-w-full" />
                      <Skeleton className="h-3 w-56 max-w-full" />
                    </div>
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <Card className="h-56 p-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-20 w-full" />
        </Card>
      </div>
    </div>
  );
}
