"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateRangeFilter, type DateRangeChange } from "@/components/date-range-filter";
import { useFilterNavigation } from "@/components/filter-navigation";
import { ScopeSelector } from "@/components/scope-selector";
import { parseDateRange } from "@/lib/date-range";
import { readScopeRequest, resolveScope, writeScopeParams, type ScopeCatalog, type ScopeChoice } from "@/lib/scope";
import { defaultRangeForPath } from "@/lib/shell";

/** Scope and period changes navigate as soon as a selection is made. */
export function GlobalFilters({ catalog, showDate = true }: { catalog: ScopeCatalog; showDate?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applying, begin } = useFilterNavigation();
  const rangeDefault = defaultRangeForPath(pathname);
  // Keep a second selection made during navigation from undoing the first.
  const params = new URLSearchParams(applying && applying.href.split("?")[0] === pathname
    ? applying.href.split("?")[1] ?? ""
    : searchParams.toString());
  const range = parseDateRange({
    range: params.get("range") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  }, rangeDefault);

  function navigate(next: URLSearchParams) {
    next.delete("page");
    next.delete("focusFrom");
    next.delete("focusTo");
    const qs = next.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    if (qs === params.toString()) return;
    const scope = resolveScope(catalog, readScopeRequest({
      client: next.get("client"), group: next.get("group"), location: next.get("location"),
    }));
    const period = parseDateRange({
      range: next.get("range") ?? undefined,
      from: next.get("from") ?? undefined,
      to: next.get("to") ?? undefined,
    }, rangeDefault);
    begin({
      title: "Updating view",
      detail: showDate ? `Loading ${scope.title} for ${period.label}.` : `Loading ${scope.title}.`,
      href,
    }, () => router.push(href, { scroll: false }));
  }

  function chooseScope(choice: ScopeChoice) {
    const next = new URLSearchParams(params);
    writeScopeParams(next, choice);
    navigate(next);
  }

  function chooseRange(change: DateRangeChange) {
    const next = new URLSearchParams(params);
    for (const key of ["range", "from", "to"] as const) {
      if (change[key]) next.set(key, change[key]);
      else next.delete(key);
    }
    navigate(next);
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Scope and period">
      <ScopeSelector
        catalog={catalog}
        request={{ client: params.get("client"), group: params.get("group"), location: params.get("location") }}
        onSelect={chooseScope}
      />
      {showDate ? (
        <DateRangeFilter
          value={range}
          defaultKey={rangeDefault}
          disabled={applying !== null}
          onChange={chooseRange}
          selectClassName="h-8 w-auto min-w-[8.5rem]"
        />
      ) : null}
    </div>
  );
}
