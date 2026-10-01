"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Star, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileRow } from "@/lib/services/dashboard";
import { ratingStarClass, ratingTextClass } from "@/lib/ui/rating-color";

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
    <section className="rounded-[20px] border border-[#e4e2de] bg-white p-5" aria-labelledby="attention-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="attention-heading" className="text-sm font-medium text-[#18161a]">
          Needs attention
        </h2>
        <span className="rounded-full bg-[#e7ff6e] px-3 py-1 text-xs font-semibold text-[#18161a]">
          {totalNeedingReply} open
        </span>
      </div>
      <ul className="mt-4 space-y-1">
        {profiles.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => open(p.id)}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-[#f3f1ee]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f1ee] text-[11px] font-semibold text-[#18161a]">
                {p.title.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#18161a]">{p.title}</p>
                <p className="truncate text-xs font-light text-[#898b91]">
                  {p.clientName ?? "Unassigned"}
                </p>
              </div>
              <span className={cn("inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums", p.avgRating != null ? ratingTextClass(p.avgRating) : "text-[#898b91]")}>
                {p.avgRating != null ? p.avgRating.toFixed(1) : "—"}
                <Star
                  className={cn("h-3 w-3", p.avgRating != null ? ratingStarClass(p.avgRating) : "fill-[#e4e2de] text-[#e4e2de]")}
                  aria-hidden
                />
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums text-[#18161a]">
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
