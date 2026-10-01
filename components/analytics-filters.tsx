"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";

interface AnalyticsFiltersProps {
  period: number;
  periods: readonly number[];
  clientId: string;
  clients: Array<{ id: string; name: string }>;
}

export function AnalyticsFilters({ period, periods, clientId, clients }: AnalyticsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function hrefWith(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center",
        pending && "opacity-70"
      )}
    >
      <div
        className="inline-flex rounded-full border border-[#d9d2ff] bg-white p-1"
        role="group"
        aria-label="Time range"
      >
        {periods.map((p) => (
          <Link
            key={p}
            href={hrefWith("months", p === 6 ? null : String(p))}
            scroll={false}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              p === period ? "bg-[#18161a] text-white" : "text-[#5f6168] hover:text-[#18161a]"
            )}
            aria-current={p === period ? "true" : undefined}
          >
            {p} months
          </Link>
        ))}
      </div>

      <select
        aria-label="Filter by client"
        value={clientId}
        onChange={(e) =>
          startTransition(() => router.push(hrefWith("client", e.target.value || null)))
        }
        className="h-10 w-full rounded-full border border-[#d9d2ff] bg-white px-4 text-sm text-[#18161a] focus:border-[#4823ff] focus:outline-none focus:ring-2 focus:ring-[#ede9ff] sm:w-64"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
