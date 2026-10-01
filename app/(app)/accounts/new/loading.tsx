import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewAccountLoading() {
  return (
    <div className="max-w-5xl" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-4 h-4 w-20" />
      <div className="space-y-2 pb-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="space-y-3 p-4">
            <Skeleton className="size-9 rounded-lg" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
