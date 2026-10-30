import { ActivityStatus } from "@/components/activity-status";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_LOADING } from "@/lib/ui-status";

/** Matches the Reviews layout: header, status tabs, filter chips, review rows. */
export default function ReviewsLoading() {
  const copy = PAGE_LOADING.reviews;
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="space-y-2.5">
        <Skeleton className="h-6 w-32 bg-[#e4e7ec]" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-3 border-b border-line pb-2.5">
        {[88, 72, 56, 110, 52, 76, 32].map((width, i) => (
          <Skeleton key={i} className="h-4" style={{ width }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-[30px] w-60 rounded-md border border-line bg-white" />
        {[96, 64, 82, 70, 84, 96].map((width, i) => (
          <Skeleton key={i} className="h-7 rounded-md border border-line bg-white" style={{ width }} />
        ))}
      </div>
      <ActivityStatus title={copy.title} detail={copy.detail} tone={copy.tone} />
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <Skeleton className="size-4" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-auto h-3 w-24" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-3 border-b border-line-2 px-4 py-3 last:border-0">
            <Skeleton className="size-4" />
            <div className="space-y-2">
              <Skeleton className={i % 2 ? "h-3 w-2/5" : "h-3 w-1/2"} />
              <Skeleton className="h-3 w-[95%]" />
              <Skeleton className={i % 3 ? "h-3 w-4/5" : "h-3 w-3/5"} />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
