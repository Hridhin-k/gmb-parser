"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Star, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileRow } from "@/lib/services/dashboard";
import { locationPlaceLabel } from "@/lib/ui/location-place";

interface AttentionQueueProps {
  profiles: ProfileRow[];
  totalNeedingReply: number;
}

export function AttentionQueue({
  profiles,
  totalNeedingReply,
}: AttentionQueueProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (profiles.length === 0) return null;

  function open(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("location", id);
    params.set("filter", "unanswered");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}#inbox`);
  }

  return (
    <section className="rounded-3xl border border-mist bg-white p-8 text-charcoal-ink" aria-labelledby="attention-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="attention-heading" className="text-heading-sm font-medium text-charcoal-ink">
          Needs attention
        </h2>
        <span className="rounded-full bg-feature-tint px-3 py-1 text-caption font-medium text-google-blue">
          {totalNeedingReply} open
        </span>
      </div>
      <ul className="mt-4 space-y-1">
        {profiles.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => open(p.id)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-canvas-white"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-feature-tint text-[11px] font-medium text-google-blue">
                {p.title.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-charcoal-ink">
                  {p.clientName ?? p.title}
                </p>
                <p className="truncate text-caption text-slate">
                  {locationPlaceLabel({
                    storeCode: p.storeCode,
                    address: p.address,
                  }) ?? p.title}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums",
                  p.avgRating == null
                    ? "text-slate"
                    : p.avgRating >= 4
                      ? "text-classroom-green"
                      : p.avgRating >= 3
                        ? "text-[#e37400]"
                        : "text-destructive"
                )}
              >
                {p.avgRating != null ? p.avgRating.toFixed(1) : "—"}
                <Star
                  className={cn(
                    "h-3 w-3",
                    p.avgRating == null
                      ? "fill-mist text-mist"
                      : p.avgRating >= 4
                        ? "fill-classroom-green text-classroom-green"
                        : p.avgRating >= 3
                          ? "fill-[#e37400] text-[#e37400]"
                          : "fill-destructive text-destructive"
                  )}
                  aria-hidden
                />
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-caption font-medium tabular-nums text-charcoal-ink">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                {p.unanswered}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
