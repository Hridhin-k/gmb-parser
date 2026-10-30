"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useFilterNavigation } from "@/components/filter-navigation";
import { ScopeSelector } from "@/components/scope-selector";
import { Button } from "@/components/ui/button";
import { parseDateRange, type DateRangeKey } from "@/lib/date-range";
import { readScopeRequest, resolveScope, writeScopeParams, type ScopeCatalog, type ScopeChoice } from "@/lib/scope";
import { defaultRangeForPath } from "@/lib/shell";

interface ScopeDraft {
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
}

interface RangeDraft {
  key: DateRangeKey;
  from: string;
  to: string;
}

/** Organisation and date stay in the navbar until Go writes them into the URL. */
export function GlobalFilters({ catalog, showDate = true }: { catalog: ScopeCatalog; showDate?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applying, begin } = useFilterNavigation();
  const appliedKey = [
    searchParams.get("client") ?? "",
    searchParams.get("group") ?? "",
    searchParams.get("location") ?? "",
    searchParams.get("range") ?? "",
    searchParams.get("from") ?? "",
    searchParams.get("to") ?? "",
  ].join("|");
  const [syncedApplied, setSyncedApplied] = useState(appliedKey);
  const [scopeDraft, setScopeDraft] = useState<ScopeDraft | null>(null);
  const [rangeDraft, setRangeDraft] = useState<RangeDraft | null>(null);
  if (syncedApplied !== appliedKey) {
    setSyncedApplied(appliedKey);
    setScopeDraft(null);
    setRangeDraft(null);
  }

  const rangeDefault = defaultRangeForPath(pathname);
  const appliedRange = parseDateRange(
    {
      range: searchParams.get("range") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    },
    rangeDefault
  );
  const shownRange = rangeDraft ?? { key: appliedRange.key, from: appliedRange.from, to: appliedRange.to };
  const appliedRequest = readScopeRequest({
    client: searchParams.get("client"),
    group: searchParams.get("group"),
    location: searchParams.get("location"),
  });
  const shownRequest = scopeDraft
    ? {
        clientId: scopeDraft.clientId ?? "",
        groupId: scopeDraft.groupId ?? "",
        locationId: scopeDraft.locationId ?? "",
      }
    : appliedRequest;

  function chooseScope(choice: ScopeChoice) {
    setScopeDraft({
      clientId: choice.clientId,
      groupId: choice.groupId,
      locationId: choice.locationId,
    });
  }

  function chooseRange(change: { range: string | null; from: string | null; to: string | null }) {
    if (change.range === "custom") {
      setRangeDraft({ key: "custom", from: change.from ?? "", to: change.to ?? "" });
      return;
    }
    setRangeDraft({ key: (change.range ?? rangeDefault) as DateRangeKey, from: "", to: "" });
  }

  function applyFilters() {
    const params = new URLSearchParams(searchParams.toString());
    writeScopeParams(params, {
      clientId: shownRequest.clientId || null,
      groupId: shownRequest.groupId || null,
      locationId: shownRequest.locationId || null,
    });
    params.delete("page");
    params.delete("focusFrom");
    params.delete("focusTo");
    if (showDate) {
      params.delete("range");
      params.delete("from");
      params.delete("to");
      if (shownRange.key === "custom") {
        params.set("range", "custom");
        if (shownRange.from) params.set("from", shownRange.from);
        if (shownRange.to) params.set("to", shownRange.to);
      } else {
        params.set("range", shownRange.key);
      }
    }
    const qs = params.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    const scope = resolveScope(catalog, shownRequest);
    const period = parseDateRange(
      { range: shownRange.key, from: shownRange.from, to: shownRange.to },
      shownRange.key
    );
    begin(
      {
        title: "Applying filters",
        detail: showDate
          ? `Loading ${scope.title} for ${period.label}. The previous numbers stay until this finishes.`
          : `Loading ${scope.title}. The previous numbers stay until this finishes.`,
        href,
      },
      () => router.push(href)
    );
  }

  const dirty = scopeDraft !== null || rangeDraft !== null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Scope and period">
      <ScopeSelector
        catalog={catalog}
        request={
          scopeDraft
            ? { client: scopeDraft.clientId, group: scopeDraft.groupId, location: scopeDraft.locationId }
            : undefined
        }
        onSelect={chooseScope}
      />
      {showDate ? (
        <DateRangeFilter
          value={shownRange}
          defaultKey={rangeDefault}
          disabled={applying !== null}
          onChange={chooseRange}
          selectClassName="h-8 w-auto min-w-[8.5rem]"
        />
      ) : null}
      {dirty ? (
        <Button type="button" size="sm" className="h-8" loading={applying !== null} onClick={applyFilters}>
          Apply
        </Button>
      ) : null}
    </div>
  );
}
