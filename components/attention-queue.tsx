"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Star, AlertCircle } from "lucide-react";
import type { ProfileRow } from "@/lib/services/dashboard";

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
    <section
      className="space-y-2"
      aria-labelledby="attention-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="attention-heading"
          className="text-sm font-semibold text-gray-900"
        >
          Needs attention
        </h2>
        <p className="text-[12px] text-gray-500">
          Top {profiles.length}
          {totalNeedingReply > profiles.length
            ? ` of ${totalNeedingReply} profiles with open replies`
            : " · highest priority first"}
        </p>
      </div>
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {profiles.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => open(p.id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-gray-900">
                  {p.title}
                </p>
                <p className="truncate text-[11px] text-gray-400">
                  {p.clientName ?? "—"}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] tabular-nums text-gray-600">
                {p.avgRating != null ? p.avgRating.toFixed(1) : "—"}
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden />
              </span>
              {p.critical > 0 && (
                <span className="shrink-0 text-[12px] font-medium tabular-nums text-red-600">
                  {p.critical}★↓
                </span>
              )}
              <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium tabular-nums text-orange-600">
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
