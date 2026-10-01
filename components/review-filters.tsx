"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Star, Search, X } from "lucide-react";

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

const PERIOD_FILTERS = [
  { key: "all", label: "All time" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
] as const;

interface ReviewFiltersProps {
  currentFilter: string;
  currentRating: string;
  currentRatingBucket: string;
  currentSearch: string;
  currentPeriod: string;
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
  currentPeriod,
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
  const [, startTransition] = useTransition();

  useEffect(() => {
    setSearchValue(currentSearch);
  }, [currentSearch]);

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
  }, [searchValue, currentSearch, pathname, router, searchParams]);

  const pushParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams]
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
    currentPeriod !== "all" ||
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

  useEffect(() => {
    setClientQuery(clientName);
  }, [clientName]);

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
      <div className="flex flex-wrap items-center gap-2">
        {useClientSearch ? (
          <div className="relative">
            <input
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
              className="h-8 w-48 rounded-md border border-gray-200 bg-white px-2.5 text-[13px] text-gray-700 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring sm:w-56"
              aria-label="Search and filter by profile"
            />
            <datalist id="dashboard-client-options">
              {matchedClients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
        ) : (
          <select
            value={currentClientId}
            onChange={(e) => {
              pushParams((params) => {
                params.delete("location");
                if (e.target.value) params.set("client", e.target.value);
                else params.delete("client");
              });
            }}
            className="h-8 rounded-md border border-gray-200 bg-white px-2.5 text-[13px] text-gray-700 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Filter by client"
          >
            <option value="">All profiles</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {filteredLocations.length > 0 && (
          <select
            value={currentLocationId}
            onChange={(e) => updateParam("location", e.target.value)}
            className="h-8 rounded-md border border-gray-200 bg-white px-2.5 text-[13px] text-gray-700 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Filter by location"
          >
            <option value="">All locations</option>
            {filteredLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.location_title}
              </option>
            ))}
          </select>
        )}

        <select
          value={currentPeriod}
          onChange={(e) => updateParam("period", e.target.value)}
          className="h-8 rounded-md border border-gray-200 bg-white px-2.5 text-[13px] text-gray-700 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter by time period"
        >
          {PERIOD_FILTERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>

        {hasActive && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => updateParam("filter", f.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              currentFilter === f.key
                ? "bg-gray-800 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() =>
            pushParams((params) => {
              params.delete("rating");
              if (currentRatingBucket === "negative") params.delete("stars");
              else params.set("stars", "negative");
            })
          }
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            currentRatingBucket === "negative"
              ? "bg-red-100 text-red-800"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          1–2★ Critical
        </button>
        <button
          type="button"
          onClick={() =>
            pushParams((params) => {
              params.delete("rating");
              if (currentRatingBucket === "positive") params.delete("stars");
              else params.set("stars", "positive");
            })
          }
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            currentRatingBucket === "positive"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          4–5★ Positive
        </button>

        <div className="mx-1 h-4 w-px bg-gray-200" aria-hidden />

        {RATING_FILTERS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() =>
              pushParams((params) => {
                params.delete("stars");
                if (currentRating === String(r)) params.delete("rating");
                else params.set("rating", String(r));
              })
            }
            className={cn(
              "flex items-center gap-0.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors",
              currentRating === String(r)
                ? "bg-amber-100 text-amber-800"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {r}
            <Star className="h-3 w-3 fill-current" aria-hidden />
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-gray-200" aria-hidden />

        <button
          type="button"
          onClick={() =>
            pushParams((params) => {
              if (currentHasComment) params.delete("comment");
              else params.set("comment", "1");
            })
          }
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            currentHasComment
              ? "bg-gray-800 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          Has comment
        </button>
      </div>

      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
          aria-hidden
        />
        <input
          type="search"
          placeholder="Search reviewer or review text…"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="h-8 w-full rounded-md border border-gray-200 bg-white pl-8 pr-3 text-[13px] text-gray-700 placeholder:text-gray-400 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring sm:max-w-sm"
          aria-label="Search reviews"
        />
      </div>
    </div>
  );
}
