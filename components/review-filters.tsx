"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useScopedTransition } from "@/components/transition-scope";
import { cn } from "@/lib/utils";
import { Star, Search } from "lucide-react";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { DateRangeFilter, type DateRangeChange } from "@/components/date-range-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import type { DateRangeKey } from "@/lib/date-range";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "unanswered", label: "Needs reply" },
  { key: "draft", label: "Drafts" },
  { key: "approved", label: "Ready to publish" },
  { key: "failed", label: "Failed" },
  { key: "published", label: "Published" },
  { key: "answered", label: "Any reply" },
] as const;

const RATING_FILTERS = [5, 4, 3, 2, 1] as const;

interface ReviewFiltersProps {
  currentFilter: string;
  currentRating: string;
  currentRatingBucket: string;
  currentSearch: string;
  currentRange: { key: DateRangeKey; from: string; to: string };
  currentHasComment: boolean;
  clients: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; location_title: string; clientId: string | null }>;
  currentClientId: string;
  currentLocationId: string;
  compact?: boolean;
}

export function ReviewFilters({
  currentFilter,
  currentRating,
  currentRatingBucket,
  currentSearch,
  currentRange,
  currentHasComment,
  clients,
  locations,
  currentClientId,
  currentLocationId,
  compact = false,
}: ReviewFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(currentSearch);
  const [syncedSearch, setSyncedSearch] = useState(currentSearch);
  const { start: startTransition } = useScopedTransition();

  if (syncedSearch !== currentSearch) {
    setSyncedSearch(currentSearch);
    setSearchValue(currentSearch);
  }

  useEffect(() => {
    if (searchValue === currentSearch) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue) params.set("q", searchValue);
      else params.delete("q");
      params.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    }, 320);
    return () => window.clearTimeout(handle);
  }, [searchValue, currentSearch, pathname, router, searchParams, startTransition]);

  const pushParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams, startTransition]
  );

  const updateParam = useCallback(
    (key: string, value: string) => {
      pushParams((params) => {
        if (value && value !== "all" && value !== "") {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      });
    },
    [pushParams]
  );

  const clearAll = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasActive =
    currentFilter !== "all" ||
    !!currentRating ||
    !!currentRatingBucket ||
    !!currentSearch ||
    currentRange.key !== "all" ||
    currentHasComment ||
    !!currentClientId ||
    !!currentLocationId;

  const filteredLocations = currentClientId
    ? locations.filter((l) => l.clientId === currentClientId)
    : locations;

  const clientName =
    clients.find((c) => c.id === currentClientId)?.name ?? "";
  const useClientSearch = clients.length > 25;
  const [clientQuery, setClientQuery] = useState(clientName);
  const [syncedClientName, setSyncedClientName] = useState(clientName);

  if (syncedClientName !== clientName) {
    setSyncedClientName(clientName);
    setClientQuery(clientName);
  }

  const matchedClients =
    useClientSearch && clientQuery.trim()
      ? clients
          .filter((c) =>
            c.name.toLowerCase().includes(clientQuery.trim().toLowerCase())
          )
          .slice(0, 40)
      : clients.slice(0, useClientSearch ? 40 : clients.length);

  return (
    <div className={cn("space-y-2.5", compact && "space-y-2")}>
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {useClientSearch ? (
          <div className="relative sm:w-56">
            <Input
              type="search"
              list="dashboard-client-options"
              value={clientQuery}
              placeholder="Search profiles…"
              onChange={(e) => {
                setClientQuery(e.target.value);
                const match = clients.find(
                  (c) =>
                    c.name.toLowerCase() === e.target.value.trim().toLowerCase()
                );
                if (match) {
                  pushParams((params) => {
                    params.delete("location");
                    params.set("client", match.id);
                  });
                } else if (!e.target.value.trim() && currentClientId) {
                  pushParams((params) => {
                    params.delete("client");
                    params.delete("location");
                  });
                }
              }}
              aria-label="Search and filter by profile"
            />
            <datalist id="dashboard-client-options">
              {matchedClients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
        ) : (
          <SelectField
            label="Filter by client"
            value={currentClientId}
            placeholder="All profiles"
            className="sm:w-auto"
            onValueChange={(next) => {
              pushParams((params) => {
                params.delete("location");
                if (next) params.set("client", next);
                else params.delete("client");
              });
            }}
            options={[
              { value: "", label: "All profiles" },
              ...clients.map((client) => ({ value: client.id, label: client.name })),
            ]}
          />
        )}

        {filteredLocations.length > 0 && (
          <SelectField
            label="Filter by location"
            value={currentLocationId}
            placeholder="All locations"
            className="sm:w-auto"
            onValueChange={(next) => updateParam("location", next)}
            options={[
              { value: "", label: "All locations" },
              ...filteredLocations.map((location) => ({
                value: location.id,
                label: location.location_title,
              })),
            ]}
          />
        )}

        <DateRangeFilter
          value={currentRange}
          defaultKey="all"
          onChange={(change: DateRangeChange) =>
            pushParams((params) => {
              params.delete("period");
              for (const [key, value] of Object.entries(change)) {
                if (value) params.set(key, value);
                else params.delete(key);
              }
            })
          }
        />

        {hasActive && <ClearFiltersButton onClear={clearAll} />}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant={currentFilter === f.key ? "default" : "outline"}
            onClick={() => updateParam("filter", f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={currentRatingBucket === "negative" ? "default" : "outline"}
          onClick={() =>
            pushParams((params) => {
              params.delete("rating");
              if (currentRatingBucket === "negative") params.delete("stars");
              else params.set("stars", "negative");
            })
          }
        >
          1–2★ Critical
        </Button>
        <Button
          type="button"
          size="sm"
          variant={currentRatingBucket === "positive" ? "default" : "outline"}
          onClick={() =>
            pushParams((params) => {
              params.delete("rating");
              if (currentRatingBucket === "positive") params.delete("stars");
              else params.set("stars", "positive");
            })
          }
        >
          4–5★ Positive
        </Button>

        <div className="mx-1 h-4 w-px bg-silver" aria-hidden />

        {RATING_FILTERS.map((r) => (
          <Button
            key={r}
            type="button"
            size="sm"
            variant={currentRating === String(r) ? "default" : "outline"}
            onClick={() =>
              pushParams((params) => {
                params.delete("stars");
                if (currentRating === String(r)) params.delete("rating");
                else params.set("rating", String(r));
              })
            }
          >
            {r}
            <Star className="h-3 w-3 fill-current" aria-hidden />
          </Button>
        ))}

        <div className="mx-1 h-4 w-px bg-silver" aria-hidden />

        <Button
          type="button"
          size="sm"
          variant={currentHasComment ? "default" : "outline"}
          onClick={() =>
            pushParams((params) => {
              if (currentHasComment) params.delete("comment");
              else params.set("comment", "1");
            })
          }
        >
          Has comment
        </Button>
      </div>

      <div className="relative sm:max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="Search reviewer or review text…"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="pl-9"
          aria-label="Search reviews"
        />
      </div>
    </div>
  );
}
