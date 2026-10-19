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
import { COMPLAINT_THEMES, REVIEW_LANGUAGES } from "@/lib/review-inbox";

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

type StatusFilter = { key: string; label: string };

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
  /** Header already owns client, date range, and search. */
  hideScope?: boolean;
  /** Page already limits the star range, so the 1–2★ and 4–5★ toggles would be ignored. */
  hideStars?: boolean;
  /** Status treated as the untouched default, so Clear does not count it. */
  defaultFilter?: string;
  statusFilters?: readonly StatusFilter[];
  showInboxFilters?: boolean;
  currentLanguage?: string;
  currentTheme?: string;
  currentAssignee?: string;
  currentGroupId?: string;
  currentSort?: string;
  currentText?: "" | "has" | "none";
  groups?: Array<{ id: string; name: string }>;
  members?: Array<{ id: string; email: string }>;
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
  hideScope = false,
  hideStars = false,
  defaultFilter = "all",
  statusFilters = STATUS_FILTERS,
  showInboxFilters = false,
  currentLanguage = "",
  currentTheme = "",
  currentAssignee = "",
  currentGroupId = "",
  currentSort = "newest",
  currentText = "",
  groups = [],
  members = [],
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
    if (hideScope) return;
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
  }, [hideScope, searchValue, currentSearch, pathname, router, searchParams, startTransition]);

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
    const params = new URLSearchParams();
    if (hideScope) {
      for (const key of ["client", "group", "location", "range", "from", "to"]) {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      }
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  const hasActive =
    currentFilter !== defaultFilter ||
    (!hideStars && (!!currentRating || !!currentRatingBucket)) ||
    (!hideScope && !!currentSearch) ||
    (!hideScope && currentRange.key !== "all") ||
    currentHasComment ||
    currentText !== "" ||
    !!currentLanguage ||
    !!currentTheme ||
    !!currentAssignee ||
    (!hideScope && !!currentGroupId) ||
    currentSort !== "newest" ||
    (!hideScope && !!currentClientId) ||
    (!hideScope && !!currentLocationId);

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
        {hideScope ? null : useClientSearch ? (
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

        {hideScope || filteredLocations.length === 0 ? null : (
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

        {hideScope ? null : (
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
        )}

        {hasActive && <ClearFiltersButton onClear={clearAll} />}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {statusFilters.map((f) => (
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
        {hideStars ? null : (
          <>
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
          </>
        )}

        {showInboxFilters ? null : (
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
        )}
        {showInboxFilters ? (
          <>
            <SelectField
              label="Text"
              value={currentText}
              options={[
                { value: "", label: "Any text" },
                { value: "has", label: "Has review text" },
                { value: "none", label: "Rating only" },
              ]}
              onValueChange={(value) =>
                pushParams((params) => {
                  if (value) params.set("text", value);
                  else params.delete("text");
                  params.delete("comment");
                })
              }
              className="sm:w-40"
            />
            <SelectField
              label="Language"
              value={currentLanguage}
              options={[{ value: "", label: "Any language" }, ...REVIEW_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))]}
              onValueChange={(value) => updateParam("language", value)}
              className="sm:w-40"
            />
            <SelectField
              label="Complaint theme"
              value={currentTheme}
              options={[{ value: "", label: "Any theme" }, ...COMPLAINT_THEMES.map((item) => ({ value: item.id, label: item.label }))]}
              onValueChange={(value) => updateParam("theme", value)}
              className="sm:w-48"
            />
            <SelectField
              label="Assignee"
              value={currentAssignee}
              options={[
                { value: "", label: "Anyone" },
                { value: "unassigned", label: "Unassigned" },
                ...members.map((member) => ({ value: member.id, label: member.email })),
              ]}
              onValueChange={(value) => updateParam("assignee", value)}
              className="sm:w-52"
            />
            {hideScope ? null : (
            <SelectField
              label="Group"
              value={currentGroupId}
              options={[{ value: "", label: "Any group" }, ...groups.map((group) => ({ value: group.id, label: group.name }))]}
              onValueChange={(value) => updateParam("group", value)}
              className="sm:w-44"
            />
            )}
            <SelectField
              label="Sort"
              value={currentSort}
              options={[
                { value: "newest", label: "Newest" },
                { value: "oldest", label: "Oldest" },
                { value: "highest", label: "Highest rating" },
                { value: "lowest", label: "Lowest rating" },
              ]}
              onValueChange={(value) => updateParam("sort", value === "newest" ? "" : value)}
              className="sm:w-40"
            />
          </>
        ) : null}
      </div>

      {hideScope ? null : (
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
      )}
    </div>
  );
}
