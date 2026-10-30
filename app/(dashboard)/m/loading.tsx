import { Skeleton } from "@/components/ui/skeleton";

export default function MobileLoading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-6 w-32 rounded bg-[#e4e7ec]" />
      <Skeleton className="h-3 w-48 rounded" />
      {[0, 1, 2].map((key) => (
        <div key={key} className="space-y-2.5 rounded-lg border border-line bg-white p-3.5">
          <Skeleton className="h-3 w-2/5 rounded" />
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-4/5 rounded" />
          <Skeleton className="h-12 w-full rounded-md bg-paper" />
        </div>
      ))}
    </div>
  );
}
