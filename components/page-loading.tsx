import type { ReactNode } from "react";
import { ActivityStatus } from "@/components/activity-status";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Variant = "clients" | "reviews" | "analytics" | "audit" | "settings" | "client" | "list";

function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn("h-3 rounded-full bg-silver/80", className)} />;
}

function Panel({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("rounded-xl bg-white p-5 shadow-card", className)}>{children}</div>;
}

function HeaderSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="h-7 w-56 rounded-lg bg-silver" />
      <Bar className="w-80 max-w-full" />
    </div>
  );
}

function FilterSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-36 rounded-lg bg-white shadow-control" />
      ))}
    </div>
  );
}

function StatTiles({ count }: { count: number }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", count === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
      {Array.from({ length: count }).map((_, i) => (
        <Panel key={i} className="space-y-3 p-4">
          <Bar className="w-20" />
          <Skeleton className="h-6 w-14 rounded-md bg-silver" />
        </Panel>
      ))}
    </div>
  );
}

function Rows({ count, avatar = false }: { count: number; avatar?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-card">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-silver px-5 py-4 last:border-0">
          {avatar && <Skeleton className="size-9 shrink-0 rounded-full bg-silver" />}
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
          <div className="flex gap-1">
            {Array.from({ length: 5 }).map((_, s) => (
              <Skeleton key={s} className="size-3.5 rounded-sm bg-[#fbbc04]/25" />
            ))}
          </div>
          <Bar className="w-full bg-silver/60" />
          <Bar className="w-4/5 bg-silver/60" />
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

function Body({ variant }: { variant: Variant }) {
  switch (variant) {
    case "clients":
      return (
        <>
          <StatTiles count={5} />
          <Rows count={5} avatar />
        </>
      );
    case "reviews":
      return (
        <>
          <FilterSkeleton count={5} />
          <ReviewCards />
        </>
      );
    case "analytics":
      return (
        <>
          <FilterSkeleton count={3} />
          <StatTiles count={4} />
          <ChartPanels />
        </>
      );
    case "audit":
      return (
        <>
          <FilterSkeleton count={4} />
          <Rows count={7} />
        </>
      );
    case "settings":
      return (
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i} className="space-y-4">
              <Skeleton className="h-5 w-40 rounded-md bg-silver" />
              <Bar className="w-4/5 bg-silver/60" />
              <Skeleton className="h-10 w-full rounded-lg bg-paper" />
              <Skeleton className="h-9 w-28 rounded-full bg-silver/70" />
            </Panel>
          ))}
        </div>
      );
    case "client":
      return (
        <>
          <StatTiles count={4} />
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <Rows count={4} avatar />
            <Panel className="h-64 space-y-3">
              <Bar className="w-28" />
              <Bar className="w-full bg-silver/60" />
              <Bar className="w-3/4 bg-silver/60" />
            </Panel>
          </div>
        </>
      );
    default:
      return <Rows count={4} />;
  }
}

export function PageLoading({
  title,
  detail,
  variant = "list",
  tone = "work",
}: {
  title: string;
  detail: string;
  variant?: Variant;
  tone?: "work" | "google" | "gemini";
}) {
  return (
    <div className="space-y-6" aria-busy="true">
      <HeaderSkeleton />
      <ActivityStatus title={title} detail={detail} tone={tone} />
      <Body variant={variant} />
    </div>
  );
}
