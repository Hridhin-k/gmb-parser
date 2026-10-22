"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useScopedTransition } from "@/components/transition-scope";
import { cn } from "@/lib/utils";
import { Star, Search } from "lucide-react";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { DateRangeFilter, type DateRangeChange } from "@/components/date-range-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { MultiSelectField } from "@/components/ui/multi-select-field";
import type { DateRangeKey } from "@/lib/date-range";
import { COMPLAINT_THEMES, REVIEW_LANGUAGES } from "@/lib/review-inbox";
import { serializeParamValues } from "@/lib/review-filter-params";

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
  /** Applied status keys (multiselect). Empty = all. */
  currentFilters: string[];
  /** Applied star ratings (multiselect). Empty = any. */
  currentRatings: number[];
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
  statusFilters?: readonly StatusFilter[];
  showInboxFilters?: boolean;
  currentLanguages?: string[];
  currentThemes?: string[];
  currentAssignees?: string[];
  currentGroupId?: string;
  currentSort?: string;
  currentText?: "" | "has" | "none";
  groups?: Array<{ id: string; name: string }>;
  members?: Array<{ id: string; email: string }>;
}

/**
 * Everything the bar can change, held as a draft. Nothing navigates until
 * Go writes the draft into the URL; the server then renders the matches.
 */
interface FilterDraft {
  statuses: string[];
  ratings: number[];
  hasComment: boolean;
  text: "" | "has" | "none";
  languages: string[];
  themes: string[];
  assignees: string[];
  groupId: string;
  sort: string;
  clientId: string;
  locationId: string;
  range: { key: DateRangeKey; from: string; to: string };
  search: string;
}

const EMPTY_DRAFT: FilterDraft = {
  statuses: [],
  ratings: [],
  hasComment: false,
  text: "",
  languages: [],
  themes: [],
  assignees: [],
  groupId: "",
  sort: "newest",
  clientId: "",
  locationId: "",
  range: { key: "all", from: "", to: "" },
  search: "",
};

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function toggleRating(list: number[], value: number): number[] {
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return next.sort((a, b) => b - a);
}

function sameRatings(a: number[], b: readonly number[]): boolean {
  return a.length === b.length && b.every((value) => a.includes(value));
}

export function ReviewFilters({
  currentFilters,
  currentRatings,
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
  statusFilters = STATUS_FILTERS,
  showInboxFilters = false,
  currentLanguages = [],
  currentThemes = [],
  currentAssignees = [],
  currentGroupId = "",
  currentSort = "newest",
  currentText = "",
  groups = [],
  members = [],
}: ReviewFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pending, start: startTransition } = useScopedTransition();

  const applied: FilterDraft = {
    statuses: currentFilters,
    ratings: [...currentRatings].sort((a, b) => b - a),
    hasComment: currentHasComment,
    text: currentText || (currentHasComment ? "has" : ""),
    languages: currentLanguages,
    themes: currentThemes,
    assignees: currentAssignees,
    groupId: currentGroupId,
    sort: currentSort,
    clientId: currentClientId,
    locationId: currentLocationId,
    range: currentRange,
    search: currentSearch,
  };
  const appliedKey = JSON.stringify(applied);
  const [syncedKey, setSyncedKey] = useState(appliedKey);
  const [draft, setDraft] = useState<FilterDraft>(applied);
  if (syncedKey !== appliedKey) {
    setSyncedKey(appliedKey);
    setDraft(applied);
  }
  const dirty = JSON.stringify(draft) !== appliedKey;

  const patch = useCallback((change: Partial<FilterDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
  }, []);

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

  function applyDraft() {
    pushParams((params) => {
      const setCsv = (key: string, values: readonly (string | number)[]) => {
        const joined = serializeParamValues(values);
        if (joined) params.set(key, joined);
        else params.delete(key);
      };
      setCsv("filter", draft.statuses);
      setCsv("rating", draft.ratings);
      params.delete("stars");
      setCsv("language", draft.languages);
      setCsv("theme", draft.themes);
      setCsv("assignee", draft.assignees);
      if (draft.text) {
        params.set("text", draft.text);
        params.delete("comment");
      } else {
        params.delete("text");
        if (!showInboxFilters && draft.hasComment) params.set("comment", "1");
        else params.delete("comment");
      }
      if (draft.sort && draft.sort !== "newest") params.set("sort", draft.sort);
      else params.delete("sort");
      if (!hideScope) {
        if (draft.groupId) params.set("group", draft.groupId);
        else params.delete("group");
        if (draft.clientId) params.set("client", draft.clientId);
        else params.delete("client");
        if (draft.locationId) params.set("location", draft.locationId);
        else params.delete("location");
        params.delete("period");
        if (draft.range.key === "custom") {
          params.set("range", "custom");
          if (draft.range.from) params.set("from", draft.range.from);
          else params.delete("from");
          if (draft.range.to) params.set("to", draft.range.to);
          else params.delete("to");
        } else if (draft.range.key !== "all") {
          params.set("range", draft.range.key);
          params.delete("from");
          params.delete("to");
        } else {
          params.delete("range");
          params.delete("from");
          params.delete("to");
        }
        if (draft.search) params.set("q", draft.search);
        else params.delete("q");
      }
    });
  }

  const clearAll = () => {
    if (!hasActive) {
      // Nothing applied yet — just forget the un-applied edits.
      setDraft(applied);
      return;
    }
    setDraft(EMPTY_DRAFT);
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
    applied.statuses.length > 0 ||
    (!hideStars && applied.ratings.length > 0) ||
    (!hideScope && !!applied.search) ||
    (!hideScope && applied.range.key !== "all") ||
    applied.hasComment ||
    applied.text !== "" ||
    applied.languages.length > 0 ||
    applied.themes.length > 0 ||
    applied.assignees.length > 0 ||
    (!hideScope && !!applied.groupId) ||
    applied.sort !== "newest" ||
    (!hideScope && !!applied.clientId) ||
    (!hideScope && !!applied.locationId);

  const filteredLocations = draft.clientId
    ? locations.filter((l) => l.clientId === draft.clientId)
    : locations;

  const clientName = clients.find((c) => c.id === draft.clientId)?.name ?? "";
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
                  patch({ clientId: match.id, locationId: "" });
                } else if (!e.target.value.trim() && draft.clientId) {
                  patch({ clientId: "", locationId: "" });
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
            value={draft.clientId}
            placeholder="All profiles"
            className="sm:w-auto"
            onValueChange={(next) => patch({ clientId: next, locationId: "" })}
            options={[
              { value: "", label: "All profiles" },
              ...clients.map((client) => ({ value: client.id, label: client.name })),
            ]}
          />
        )}

        {hideScope || filteredLocations.length === 0 ? null : (
          <SelectField
            label="Filter by location"
            value={draft.locationId}
            placeholder="All locations"
            className="sm:w-auto"
            onValueChange={(next) => patch({ locationId: next })}
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
            value={draft.range}
            defaultKey="all"
            onChange={(change: DateRangeChange) =>
              patch({
                range: {
                  key: (change.range ?? "all") as DateRangeKey,
                  from: change.from ?? "",
                  to: change.to ?? "",
                },
              })
            }
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {statusFilters.map((f) =>
          f.key === "all" ? (
            <Button
              key={f.key}
              type="button"
              size="sm"
              variant={draft.statuses.length === 0 ? "default" : "outline"}
              aria-pressed={draft.statuses.length === 0}
              onClick={() => patch({ statuses: [] })}
            >
              {f.label}
            </Button>
          ) : (
            <Button
              key={f.key}
              type="button"
              size="sm"
              variant={draft.statuses.includes(f.key) ? "default" : "outline"}
              aria-pressed={draft.statuses.includes(f.key)}
              onClick={() => patch({ statuses: toggleValue(draft.statuses, f.key) })}
            >
              {f.label}
            </Button>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {hideStars ? null : (
          <>
        <Button
          type="button"
          size="sm"
          variant={sameRatings(draft.ratings, [1, 2]) ? "default" : "outline"}
          aria-pressed={sameRatings(draft.ratings, [1, 2])}
          onClick={() => patch({ ratings: sameRatings(draft.ratings, [1, 2]) ? [] : [2, 1] })}
        >
          1–2★ Critical
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sameRatings(draft.ratings, [4, 5]) ? "default" : "outline"}
          aria-pressed={sameRatings(draft.ratings, [4, 5])}
          onClick={() => patch({ ratings: sameRatings(draft.ratings, [4, 5]) ? [] : [5, 4] })}
        >
          4–5★ Positive
        </Button>

        <div className="mx-1 h-4 w-px bg-silver" aria-hidden />

        {RATING_FILTERS.map((r) => (
          <Button
            key={r}
            type="button"
            size="sm"
            variant={draft.ratings.includes(r) ? "default" : "outline"}
            aria-pressed={draft.ratings.includes(r)}
            aria-label={`${r} star reviews`}
            onClick={() => patch({ ratings: toggleRating(draft.ratings, r) })}
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
          variant={draft.hasComment ? "default" : "outline"}
          aria-pressed={draft.hasComment}
          onClick={() => patch({ hasComment: !draft.hasComment })}
        >
          Has comment
        </Button>
        )}
        {showInboxFilters ? (
          <>
            <SelectField
              label="Text"
              value={draft.text}
              options={[
                { value: "", label: "Any text" },
                { value: "has", label: "Has review text" },
                { value: "none", label: "Rating only" },
              ]}
              onValueChange={(value) =>
                patch({ text: value === "has" || value === "none" ? value : "" })
              }
              className="sm:w-40"
            />
            <MultiSelectField
              label="Language"
              values={draft.languages}
              options={REVIEW_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))}
              placeholder="Any language"
              onChange={(values) => patch({ languages: values })}
              className="sm:w-40"
            />
            <MultiSelectField
              label="Complaint theme"
              values={draft.themes}
              options={COMPLAINT_THEMES.map((item) => ({ value: item.id, label: item.label }))}
              placeholder="Any theme"
              onChange={(values) => patch({ themes: values })}
              className="sm:w-48"
            />
            <MultiSelectField
              label="Assignee"
              values={draft.assignees}
              options={[
                { value: "unassigned", label: "Unassigned" },
                ...members.map((member) => ({ value: member.id, label: member.email })),
              ]}
              placeholder="Anyone"
              onChange={(values) => patch({ assignees: values })}
              className="sm:w-52"
            />
            {hideScope ? null : (
            <SelectField
              label="Group"
              value={draft.groupId}
              options={[{ value: "", label: "Any group" }, ...groups.map((group) => ({ value: group.id, label: group.name }))]}
              onValueChange={(value) => patch({ groupId: value })}
              className="sm:w-44"
            />
            )}
            <SelectField
              label="Sort"
              value={draft.sort}
              options={[
                { value: "newest", label: "Newest" },
                { value: "oldest", label: "Oldest" },
                { value: "highest", label: "Highest rating" },
                { value: "lowest", label: "Lowest rating" },
              ]}
              onValueChange={(value) => patch({ sort: value })}
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
          value={draft.search}
          onChange={(e) => patch({ search: e.target.value })}
          className="pl-9"
          aria-label="Search reviews"
        />
      </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button type="button" disabled={!dirty || pending} onClick={applyDraft}>
          {pending ? "Applying…" : "Go"}
        </Button>
        {dirty ? (
          <span className="text-xs text-slate" role="status">
            Filters changed — press Go to apply.
          </span>
        ) : null}
        {(hasActive || dirty) && <ClearFiltersButton onClear={clearAll} disabled={pending} />}
      </div>
    </div>
  );
}
