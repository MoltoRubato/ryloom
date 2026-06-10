import { Skeleton } from "@/components/ui/skeleton";

/** Streaming fallback for the edit studio while the RSC data loads. */
export function EditStudioSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <div className="flex justify-between">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-28" />
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
