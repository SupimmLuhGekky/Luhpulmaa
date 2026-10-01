import { Skeleton } from "@/components/ui/skeleton";

export default function AssistantLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4" aria-busy="true">
      <div className="space-y-2 pb-1">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
