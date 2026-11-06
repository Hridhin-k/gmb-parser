"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateRangeFilter, type DateRangeChange } from "@/components/date-range-filter";
import { useFilterNavigation } from "@/components/filter-navigation";
import { parseDateRange } from "@/lib/date-range";

/** The review list, tab totals and CSV export all read the same URL period. */
export function ReviewsDateSelect() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applying, begin } = useFilterNavigation();
  const params = new URLSearchParams(
    applying && applying.href.split("?")[0] === pathname
      ? applying.href.split("?")[1] ?? ""
      : searchParams.toString()
  );
  const range = parseDateRange({ range: params.get("range"), from: params.get("from"), to: params.get("to") }, "all");

  function choose(change: DateRangeChange) {
    const next = new URLSearchParams(params);
    for (const key of ["range", "from", "to"] as const) {
      if (change[key]) next.set(key, change[key]);
      else next.delete(key);
    }
    // A linked chart window overrides the period on the server. Clear it when
    // the person picks a new period, together with old pagination/selection.
    for (const key of ["focusFrom", "focusTo", "page", "review", "id"]) next.delete(key);
    if (next.toString() === params.toString()) return;
    const href = next.size ? `${pathname}?${next}` : pathname;
    const period = parseDateRange({ range: next.get("range"), from: next.get("from"), to: next.get("to") }, "all");
    begin({ title: "Updating reviews", detail: `Loading ${period.label.toLowerCase()}.`, href }, () =>
      router.push(href, { scroll: false })
    );
  }

  return <DateRangeFilter value={range} defaultKey="all" disabled={applying !== null} onChange={choose}
    selectClassName="h-10 w-auto min-w-[10rem]" />;
}
