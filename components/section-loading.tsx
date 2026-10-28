import type { ReactNode } from "react";
import { ActivityStatus } from "@/components/activity-status";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_LOADING } from "@/lib/ui-status";
import { cn } from "@/lib/utils";

type Variant = "tiles" | "charts" | "rows" | "reviews" | "filters" | "panel" | "settings";

function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn("h-3 rounded-full bg-silver/80", className)} />;
}

function Panel({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("rounded-xl bg-white p-5 shadow-card", className)}>{children}</div>;
}

function StatTiles({ count }: { count: number }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", count >= 5 ? "lg:grid-cols-5 xl:grid-cols-6" : "lg:grid-cols-4")}>
      {Array.from({ length: count }).map((_, i) => (
        <Panel key={i} className="space-y-3 p-4">
          <Bar className="w-20" />
          <Skeleton className="h-6 w-14 rounded-md bg-silver" />
        </Panel>
      ))}
    </div>
  );
}

function ChartPanels() {
  const heights = [40, 65, 52, 78, 60, 88, 70, 95, 58, 82, 66, 90];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {[0, 1].map((panel) => (
        <Panel key={panel} className="space-y-4">
          <Bar className="w-32" />
          <div className="flex h-44 items-end gap-2">
            {heights.map((h, i) => (
              <Skeleton
                key={i}
                className="flex-1 rounded-t-md rounded-b-none bg-silver/70"
                style={{ height: `${panel ? 100 - h * 0.6 : h}%` }}
              />
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-card">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-silver px-5 py-4 last:border-0">
          <div className="min-w-0 flex-1 space-y-2">
            <Bar className={i % 2 ? "w-1/3" : "w-2/5"} />
            <Bar className="w-3/5 bg-silver/50" />
          </div>
          <Skeleton className="h-6 w-20 shrink-0 rounded-full bg-silver/70" />
        </div>
      ))}
    </div>
  );
}

function ReviewCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Panel key={i} className="space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full bg-silver" />
            <div className="flex-1 space-y-1.5">
              <Bar className="w-24" />
              <Bar className="w-16 bg-silver/50" />
            </div>
          </div>
          <Bar className="w-full bg-silver/60" />
          <Bar className="w-4/5 bg-silver/60" />
        </Panel>
      ))}
    </div>
  );
}

function Body({ variant }: { variant: Variant }) {
  switch (variant) {
    case "tiles":
      return <StatTiles count={6} />;
    case "charts":
      return (
        <>
          <StatTiles count={4} />
          <ChartPanels />
        </>
      );
    case "rows":
      return <Rows count={5} />;
    case "reviews":
      return <ReviewCards />;
    case "filters":
      return (
        <>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-36 rounded-lg bg-white shadow-control" />
            ))}
          </div>
          <ReviewCards />
        </>
      );
    case "settings":
      return (
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Panel key={i} className="space-y-4">
              <Skeleton className="h-5 w-40 rounded-md bg-silver" />
              <Bar className="w-4/5 bg-silver/60" />
              <Skeleton className="h-10 w-full rounded-lg bg-paper" />
            </Panel>
          ))}
        </div>
      );
    case "panel":
    default:
      return (
        <Panel className="space-y-4">
          <Bar className="w-40" />
          <Bar className="w-full bg-silver/60" />
          <Bar className="w-3/4 bg-silver/60" />
          <Skeleton className="h-40 w-full rounded-lg bg-paper" />
        </Panel>
      );
  }
}

/**
 * In-page section skeleton for Suspense fallbacks.
 * Header / chrome stay painted; only this region shows busy state.
 */
export function SectionLoading({
  page = "default",
  variant = "panel",
  className,
  title,
  detail,
}: {
  page?: keyof typeof PAGE_LOADING;
  variant?: Variant;
  className?: string;
  title?: string;
  detail?: string;
}) {
  const copy = PAGE_LOADING[page];
  return (
    <div className={cn("space-y-4", className)} aria-busy="true">
      <ActivityStatus title={title ?? copy.title} detail={detail ?? copy.detail} tone={copy.tone} />
      <Body variant={variant} />
    </div>
  );
}
