"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Check, ChevronDown, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { useScopedTransition } from "@/components/transition-scope";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COMPLAINT_THEMES, REVIEW_LANGUAGES } from "@/lib/review-inbox";
import { serializeParamValues } from "@/lib/review-filter-params";
import {
  REVIEW_STATUS_OPTIONS,
  activeStatusTab,
  statusLabel,
  type ReviewStatusOption,
} from "@/components/reviews-status";

const RATING_FILTERS = [5, 4, 3, 2, 1] as const;

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "highest", label: "Highest rating" },
  { value: "lowest", label: "Lowest rating" },
] as const;

const TEXT_OPTIONS = [
  { value: "", label: "Any" },
  { value: "has", label: "Has review text" },
  { value: "none", label: "Rating only" },
] as const;

/** Scope and period belong to the top bar; status belongs to the tabs. Clear keeps both. */
const KEPT_ON_CLEAR = ["client", "group", "location", "range", "from", "to", "filter"] as const;

interface ReviewFiltersProps {
  /** Applied status keys (multiselect). Empty = all. Tabs normally own this. */
  currentFilters: string[];
  /** Applied star ratings (multiselect). Empty = any. */
  currentRatings: number[];
  currentSearch: string;
  currentHasComment: boolean;
  currentLanguages?: string[];
  currentThemes?: string[];
  currentAssignees?: string[];
  currentSort?: string;
  currentText?: "" | "has" | "none";
  members?: Array<{ id: string; email: string }>;
  /** Statuses offered in More filters. */
  statusFilters?: readonly ReviewStatusOption[];
  /** Matching reviews for the applied filters, shown in the summary. */
  resultCount?: number;
}

/**
 * Everything the More filters drawer can change, held as a draft. Nothing
 * navigates until Apply writes it into the URL; the server renders the matches.
 * Quick chips and the inline search apply one change at a time, straight away.
 */
interface FilterDraft {
  statuses: string[];
  ratings: number[];
  text: "" | "has" | "none";
  languages: string[];
  themes: string[];
  assignees: string[];
  sort: string;
}

const EMPTY_DRAFT: FilterDraft = {
  statuses: [],
  ratings: [],
  text: "",
  languages: [],
  themes: [],
  assignees: [],
  sort: "newest",
};

function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function sortRatings(list: number[]): number[] {
  return [...list].sort((a, b) => b - a);
}

function sameRatings(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && b.every((value) => a.includes(value));
}

function summarize(labels: string[], fallback: string): string {
  if (labels.length === 0) return fallback;
  if (labels.length === 1) return labels[0]!;
  return `${labels[0]} +${labels.length - 1}`;
}

function ratingSummary(ratings: readonly number[]): string {
  if (ratings.length === 0) return "Stars";
  const sorted = [...ratings].sort((a, b) => a - b);
  const contiguous = sorted.every((value, index) => index === 0 || value === sorted[index - 1]! + 1);
  if (contiguous && sorted.length > 1) return `★ ${sorted[0]}–${sorted[sorted.length - 1]}`;
  return `★ ${sorted.join(", ")}`;
}

export function ReviewFilters({
  currentFilters,
  currentRatings,
  currentSearch,
  currentHasComment,
  currentLanguages = [],
  currentThemes = [],
  currentAssignees = [],
  currentSort = "newest",
  currentText = "",
  members = [],
  statusFilters = REVIEW_STATUS_OPTIONS,
  resultCount,
}: ReviewFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pending, start: startTransition } = useScopedTransition();

  const applied: FilterDraft = {
    statuses: currentFilters,
    ratings: sortRatings(currentRatings),
    text: currentText || (currentHasComment ? "has" : ""),
    languages: currentLanguages,
    themes: currentThemes,
    assignees: currentAssignees,
    sort: currentSort,
  };

  // Inline search box mirrors `q` until the user types.
  const [search, setSearch] = useState(currentSearch);
  const [syncedSearch, setSyncedSearch] = useState(currentSearch);
  if (syncedSearch !== currentSearch) {
    setSyncedSearch(currentSearch);
    setSearch(currentSearch);
  }

  const pushParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("page");
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [router, pathname, searchParams, startTransition]
  );

  /** Write a full filter state into the URL (same params as before the redesign). */
  function apply(change: Partial<FilterDraft>) {
    const next: FilterDraft = { ...applied, ...change };
    pushParams((params) => {
      const setCsv = (key: string, values: readonly (string | number)[]) => {
        const joined = serializeParamValues(values);
        if (joined) params.set(key, joined);
        else params.delete(key);
      };
      setCsv("filter", next.statuses);
      setCsv("rating", next.ratings);
      params.delete("stars");
      setCsv("language", next.languages);
      setCsv("theme", next.themes);
      setCsv("assignee", next.assignees);
      if (next.text) params.set("text", next.text);
      else params.delete("text");
      params.delete("comment");
      if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
      else params.delete("sort");
    });
  }

  function applySearch(value: string) {
    const trimmed = value.trim();
    if (trimmed === currentSearch) return;
    pushParams((params) => {
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
    });
  }

  const customStatus = activeStatusTab(applied.statuses) === null;
  const activeCount =
    (customStatus ? 1 : 0) +
    (applied.ratings.length > 0 ? 1 : 0) +
    (applied.text ? 1 : 0) +
    (applied.languages.length > 0 ? 1 : 0) +
    (applied.themes.length > 0 ? 1 : 0) +
    (applied.assignees.length > 0 ? 1 : 0) +
    (currentSearch ? 1 : 0);
  const hasActive = activeCount > 0 || applied.sort !== "newest";

  function clearAll() {
    const params = new URLSearchParams();
    for (const key of KEPT_ON_CLEAR) {
      const value = searchParams.get(key);
      if (!value) continue;
      // A custom status combination is a filter, not a tab. Clear drops it.
      if (key === "filter" && customStatus) continue;
      params.set(key, value);
    }
    setSearch("");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const critical = sameRatings(applied.ratings, [1, 2]);
  const memberLabel = (id: string) =>
    id === "unassigned" ? "Unassigned" : (members.find((member) => member.id === id)?.email ?? "Teammate");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        role="search"
        className="relative w-full sm:w-60"
        onSubmit={(event) => {
          event.preventDefault();
          applySearch(search);
        }}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search these reviews"
          aria-label="Search in these reviews"
          className="h-[30px] pl-8 text-[13px]"
        />
      </form>

      <button
        type="button"
        aria-pressed={critical}
        disabled={pending}
        onClick={() => apply({ ratings: critical ? [] : [2, 1] })}
        className={chipClass(critical)}
      >
        <Star className="size-3 fill-current" aria-hidden />
        1–2 critical
        {critical ? <X className="size-3 text-ink-3" aria-hidden /> : null}
      </button>

      <ChipMenu
        label="Stars"
        summary={ratingSummary(applied.ratings)}
        active={applied.ratings.length > 0}
        disabled={pending}
        options={RATING_FILTERS.map((rating) => ({ value: String(rating), label: `${rating} star${rating === 1 ? "" : "s"}` }))}
        values={applied.ratings.map(String)}
        onApply={(values) => apply({ ratings: sortRatings(values.map(Number)) })}
      />
      <ChipMenu
        label="Language"
        summary={summarize(
          REVIEW_LANGUAGES.filter((item) => applied.languages.includes(item.id)).map((item) => item.label),
          "Language"
        )}
        active={applied.languages.length > 0}
        disabled={pending}
        options={REVIEW_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))}
        values={applied.languages}
        onApply={(values) => apply({ languages: values })}
      />
      <ChipMenu
        label="Theme"
        summary={summarize(
          COMPLAINT_THEMES.filter((item) => applied.themes.includes(item.id)).map((item) => item.label),
          "Theme"
        )}
        active={applied.themes.length > 0}
        disabled={pending}
        options={COMPLAINT_THEMES.map((item) => ({ value: item.id, label: item.label }))}
        values={applied.themes}
        onApply={(values) => apply({ themes: values })}
      />
      <ChipMenu
        label="Assignee"
        summary={summarize(applied.assignees.map(memberLabel), "Assignee")}
        active={applied.assignees.length > 0}
        disabled={pending}
        options={[
          { value: "unassigned", label: "Unassigned" },
          ...members.map((member) => ({ value: member.id, label: member.email })),
        ]}
        values={applied.assignees}
        onApply={(values) => apply({ assignees: values })}
      />
      {customStatus ? (
        <span className={cn(chipClass(true), "cursor-default")}>
          Status: {summarize(applied.statuses.map(statusLabel), "Any")}
          <button
            type="button"
            className="-mr-1 rounded p-0.5 text-ink-3 hover:text-ink"
            aria-label="Remove status filter"
            disabled={pending}
            onClick={() => apply({ statuses: [] })}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ) : null}
      {applied.text ? (
        <span className={cn(chipClass(true), "cursor-default")}>
          {applied.text === "has" ? "Has review text" : "Rating only"}
          <button
            type="button"
            className="-mr-1 rounded p-0.5 text-ink-3 hover:text-ink"
            aria-label="Remove review text filter"
            disabled={pending}
            onClick={() => apply({ text: "" })}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ) : null}

      <MoreFilters
        applied={applied}
        statusFilters={statusFilters}
        members={members}
        pending={pending}
        onApply={(draft) => apply(draft)}
      />

      <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3 sm:ml-auto sm:w-auto" aria-live="polite">
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner size="xs" /> Updating…
          </span>
        ) : (
          <>
            <span>
              {activeCount === 0 ? "No filters" : `${activeCount} filter${activeCount === 1 ? "" : "s"}`}
              {typeof resultCount === "number" ? (
                <>
                  {" · "}
                  <b className="font-semibold text-ink tabular-nums">
                    {resultCount.toLocaleString("en-US")} review{resultCount === 1 ? "" : "s"}
                  </b>
                </>
              ) : null}
            </span>
            {hasActive ? (
              <>
                <span aria-hidden>·</span>
                <button type="button" onClick={clearAll} className="font-medium text-brand hover:underline">
                  Clear
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function chipClass(active: boolean) {
  return cn(
    "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-line disabled:opacity-50",
    active ? "border-brand-line bg-brand-tint text-brand" : "border-line bg-white text-ink-2 hover:bg-paper"
  );
}

/** A filter chip that opens a checkbox list. Changes apply with the Apply button. */
function ChipMenu({
  label,
  summary,
  active,
  options,
  values,
  onApply,
  disabled,
}: {
  label: string;
  summary: string;
  active: boolean;
  options: Array<{ value: string; label: string }>;
  values: string[];
  onApply: (values: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<string[]>(values);
  const changed = local.length !== values.length || local.some((value) => !values.includes(value));

  return (
    <span className="inline-flex items-center">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setLocal(values);
          setOpen(next);
        }}
      >
        <PopoverTrigger
          disabled={disabled}
          aria-label={`${label}: ${active ? summary : "any"}`}
          className={cn(chipClass(active), active && "rounded-r-none border-r-0")}
        >
          {summary}
          <ChevronDown className="size-3 opacity-70" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 gap-0 p-1">
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</p>
          <div role="group" aria-label={label} className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const on = local.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => setLocal((current) => toggleValue(current, option.value))}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink outline-none hover:bg-paper focus-visible:bg-paper"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-[#aeb6c2] bg-white text-white",
                      on && "border-brand bg-brand"
                    )}
                  >
                    {on ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-line-2 px-1 pt-1.5 pb-0.5">
            <Button type="button" size="xs" variant="ghost" disabled={local.length === 0} onClick={() => setLocal([])}>
              Clear
            </Button>
            <Button
              type="button"
              size="xs"
              disabled={!changed}
              onClick={() => {
                setOpen(false);
                onApply(local);
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {active ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onApply([])}
          aria-label={`Remove ${label.toLowerCase()} filter`}
          className="inline-flex h-7 items-center rounded-r-md border border-l-0 border-brand-line bg-brand-tint pr-2 pl-1 text-ink-3 hover:text-ink disabled:opacity-50"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** The single-choice sort menu shown in the list header. */
export function ReviewSortMenu({ currentSort = "newest" }: { currentSort?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pending, start: startTransition } = useScopedTransition();
  const [open, setOpen] = useState(false);
  const label = SORT_OPTIONS.find((option) => option.value === currentSort)?.label ?? "Newest";

  function choose(value: string) {
    setOpen(false);
    if (value === currentSort) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === "newest") params.delete("sort");
    else params.set("sort", value);
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={pending}
        aria-label={`Sort: ${label}`}
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-3 outline-none hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-line disabled:opacity-50"
      >
        Sort: <span className="font-medium text-ink-2">{label}</span>
        <ChevronDown className="size-3" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 gap-0 p-1">
        <div role="menu" aria-label="Sort reviews">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === currentSort}
              onClick={() => choose(option.value)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink outline-none hover:bg-paper focus-visible:bg-paper"
            >
              {option.label}
              {option.value === currentSort ? <Check className="size-3.5 text-brand" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Advanced filters in a right-hand drawer, applied together. */
function MoreFilters({
  applied,
  statusFilters,
  members,
  pending,
  onApply,
}: {
  applied: FilterDraft;
  statusFilters: readonly ReviewStatusOption[];
  members: Array<{ id: string; email: string }>;
  pending: boolean;
  onApply: (draft: FilterDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterDraft>(applied);
  const appliedKey = JSON.stringify(applied);
  const dirty = JSON.stringify(draft) !== appliedKey;
  const advancedCount =
    (applied.text ? 1 : 0) + (activeStatusTab(applied.statuses) === null ? 1 : 0) + (applied.sort !== "newest" ? 1 : 0);

  const patch = (change: Partial<FilterDraft>) => setDraft((current) => ({ ...current, ...change }));

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(applied);
        setOpen(next);
      }}
    >
      <DialogPrimitive.Trigger
        disabled={pending}
        className={cn(chipClass(advancedCount > 0), advancedCount > 0 && "border-brand")}
      >
        <SlidersHorizontal className="size-3" aria-hidden />
        More filters{advancedCount > 0 ? ` · ${advancedCount}` : ""}
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink/30 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-line bg-white shadow-overlay outline-none data-open:animate-in data-open:slide-in-from-right-4">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <DialogPrimitive.Title className="text-sm font-semibold text-ink">More filters</DialogPrimitive.Title>
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                Reset
              </Button>
              <DialogPrimitive.Close
                render={<Button type="button" size="icon-sm" variant="ghost" aria-label="Close more filters" />}
              >
                <X className="size-4" aria-hidden />
              </DialogPrimitive.Close>
            </div>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Combine statuses, ratings, languages, themes and assignees. Apply to update the list.
          </DialogPrimitive.Description>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-[13px]">
            <FieldGroup label="Status">
              <div className="space-y-2">
                {statusFilters
                  .filter((option) => option.key !== "all")
                  .map((option) => (
                    <label key={option.key} className="flex cursor-pointer items-start gap-2.5">
                      <Checkbox
                        className="mt-0.5"
                        checked={draft.statuses.includes(option.key)}
                        onCheckedChange={() => patch({ statuses: toggleValue(draft.statuses, option.key) })}
                      />
                      <span>
                        <span className="text-ink">{option.label}</span>
                        {option.hint ? <span className="block text-xs text-ink-3">{option.hint}</span> : null}
                      </span>
                    </label>
                  ))}
              </div>
              <p className="text-xs text-ink-3">None checked shows every status. The tabs above are shortcuts for one status.</p>
            </FieldGroup>

            <FieldGroup label="Stars">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={sameRatings(draft.ratings, [1, 2])}
                  onClick={() => patch({ ratings: sameRatings(draft.ratings, [1, 2]) ? [] : [2, 1] })}
                  className={chipClass(sameRatings(draft.ratings, [1, 2]))}
                >
                  1–2★ critical
                </button>
                <button
                  type="button"
                  aria-pressed={sameRatings(draft.ratings, [4, 5])}
                  onClick={() => patch({ ratings: sameRatings(draft.ratings, [4, 5]) ? [] : [5, 4] })}
                  className={chipClass(sameRatings(draft.ratings, [4, 5]))}
                >
                  4–5★ positive
                </button>
                <span className="mx-0.5 h-7 w-px bg-line" aria-hidden />
                {RATING_FILTERS.map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    aria-pressed={draft.ratings.includes(rating)}
                    aria-label={`${rating} star reviews`}
                    onClick={() => patch({ ratings: sortRatings(toggleValue(draft.ratings, rating)) })}
                    className={chipClass(draft.ratings.includes(rating))}
                  >
                    {rating}
                    <Star className="size-3 fill-current" aria-hidden />
                  </button>
                ))}
              </div>
            </FieldGroup>

            <FieldGroup label="Review text">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Review text">
                {TEXT_OPTIONS.map((option) => (
                  <button
                    key={option.value || "any"}
                    type="button"
                    role="radio"
                    aria-checked={draft.text === option.value}
                    onClick={() => patch({ text: option.value })}
                    className={chipClass(draft.text === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </FieldGroup>

            <CheckList
              label="Language"
              options={REVIEW_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))}
              values={draft.languages}
              onToggle={(value) => patch({ languages: toggleValue(draft.languages, value) })}
            />
            <CheckList
              label="Complaint theme"
              options={COMPLAINT_THEMES.map((item) => ({ value: item.id, label: item.label }))}
              values={draft.themes}
              onToggle={(value) => patch({ themes: toggleValue(draft.themes, value) })}
            />
            <CheckList
              label="Assignee"
              options={[
                { value: "unassigned", label: "Unassigned" },
                ...members.map((member) => ({ value: member.id, label: member.email })),
              ]}
              values={draft.assignees}
              onToggle={(value) => patch({ assignees: toggleValue(draft.assignees, value) })}
            />

            <FieldGroup label="Sort">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Sort">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={draft.sort === option.value}
                    onClick={() => patch({ sort: option.value })}
                    className={chipClass(draft.sort === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </FieldGroup>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
            <Button type="button" variant="outline" size="sm" disabled title="Saved views are not available yet">
              Save view · Coming soon
            </Button>
            <span className="flex-1" />
            {dirty ? (
              <span className="text-xs text-ink-3" role="status">
                Not applied yet
              </span>
            ) : null}
            <Button
              type="button"
              disabled={!dirty || pending}
              onClick={() => {
                setOpen(false);
                onApply(draft);
              }}
            >
              Apply filters
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-medium text-ink-2">{label}</legend>
      {children}
    </fieldset>
  );
}

function CheckList({
  label,
  options,
  values,
  onToggle,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  values: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <FieldGroup label={label}>
      <div className="max-h-48 space-y-2 overflow-y-auto">
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2.5">
            <Checkbox checked={values.includes(option.value)} onCheckedChange={() => onToggle(option.value)} />
            <span className="min-w-0 truncate text-ink">{option.label}</span>
          </label>
        ))}
      </div>
    </FieldGroup>
  );
}
