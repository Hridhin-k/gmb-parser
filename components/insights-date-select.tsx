"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateRangeFilter, type DateRangeChange } from "@/components/date-range-filter";
import { useFilterNavigation } from "@/components/filter-navigation";
import { parseDateRange, type DateRangeKey } from "@/lib/date-range";

/**
 * The Insights period. The header has no date filter, so the page owns one.
 * It writes `range`, `from` and `to`, keeps the tab and place, and drops
 * anything tied to the old period (a picked topic or month).
 */
export function InsightsDateSelect({ defaultKey }: { defaultKey: DateRangeKey }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applying, begin } = useFilterNavigation();
  const params = new URLSearchParams(
    applying && applying.href.split("?")[0] === pathname ? (applying.href.split("?")[1] ?? "") : searchParams.toString()
  );
  const range = parseDateRange(
    { range: params.get("range") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined },
    defaultKey
  );

  function choose(change: DateRangeChange) {
    const next = new URLSearchParams(params);
    for (const key of ["range", "from", "to"] as const) {
      if (change[key]) next.set(key, change[key]);
      else next.delete(key);
    }
    next.delete("page");
    next.delete("month");
    const qs = next.toString();
    if (qs === params.toString()) return;
    const href = qs ? `${pathname}?${qs}` : pathname;
    const period = parseDateRange(
      { range: next.get("range") ?? undefined, from: next.get("from") ?? undefined, to: next.get("to") ?? undefined },
      defaultKey
    );
    begin({ title: "Updating insights", detail: `Loading ${period.label.toLowerCase()}.`, href }, () =>
      router.push(href, { scroll: false })
    );
  }

  return (
    <DateRangeFilter
      value={range}
      defaultKey={defaultKey}
      disabled={applying !== null}
      onChange={choose}
      selectClassName="h-10 w-auto min-w-[10rem]"
    />
  );
}
