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
  const [syncedSearch, setSyncedSearch] = useState(currentSearch);
  const [, startTransition] = useTransition();

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
              className="h-10 w-full rounded-full border border-[#dadce0] bg-white px-4 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#e8f0fe] sm:w-56"
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
            className="h-10 w-full rounded-full border border-[#dadce0] bg-white px-4 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#e8f0fe] sm:w-auto"
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
            className="h-10 w-full rounded-full border border-[#dadce0] bg-white px-4 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#e8f0fe] sm:w-auto"
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
          className="h-10 w-full rounded-full border border-[#dadce0] bg-white px-4 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#e8f0fe] sm:w-auto"
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
            className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm text-[#5f6368] hover:bg-[#e8f0fe] hover:text-[#1a73e8]"
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
              "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
              currentFilter === f.key
                ? "bg-[#1a73e8] text-white"
                : "bg-[#e8f0fe] text-[#202124] hover:bg-[#dadce0]"
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
            "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
            currentRatingBucket === "negative"
              ? "bg-google-blue text-white"
              : "bg-[#e8f0fe] text-[#202124] hover:bg-[#dadce0]"
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
            "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
            currentRatingBucket === "positive"
              ? "bg-[#1a73e8] text-white"
              : "bg-[#e8f0fe] text-[#202124] hover:bg-[#dadce0]"
          )}
        >
          4–5★ Positive
        </button>

        <div className="mx-1 h-4 w-px bg-[#dadce0]" aria-hidden />

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
              "flex items-center gap-0.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
              currentRating === String(r)
                ? "bg-[#1a73e8] text-white"
                : "bg-[#e8f0fe] text-[#202124] hover:bg-[#dadce0]"
            )}
          >
            {r}
            <Star className="h-3 w-3 fill-current" aria-hidden />
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-[#dadce0]" aria-hidden />

        <button
          type="button"
          onClick={() =>
            pushParams((params) => {
              if (currentHasComment) params.delete("comment");
              else params.set("comment", "1");
            })
          }
          className={cn(
            "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
            currentHasComment
              ? "bg-[#1a73e8] text-white"
              : "bg-[#e8f0fe] text-[#202124] hover:bg-[#dadce0]"
          )}
        >
          Has comment
        </button>
      </div>

      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5f6368]"
          aria-hidden
        />
        <input
          type="search"
          placeholder="Search reviewer or review text…"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="h-10 w-full rounded-full border border-[#dadce0] bg-white pl-9 pr-4 text-sm text-[#202124] placeholder:text-[#5f6368] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#e8f0fe] sm:max-w-sm"
          aria-label="Search reviews"
        />
      </div>
    </div>
  );
}
