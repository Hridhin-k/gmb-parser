"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronDown, MapPin, Search, UsersRound } from "lucide-react";
import { useFilterNavigation } from "@/components/filter-navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { scopeFilterApply } from "@/lib/filter-apply";
import {
  choiceMatchesScope,
  filterScopeChoices,
  readScopeRequest,
  resolveScope,
  scopeChoices,
  scopeSummary,
  writeScopeParams,
  type ScopeCatalog,
  type ScopeChoice,
} from "@/lib/scope";
import { cn } from "@/lib/utils";
import { modernizeCopy, scopeKindLabel } from "@/lib/ui/vocabulary";

function KindIcon({ kind }: { kind: ScopeChoice["kind"] }) {
  const className = "size-3.5 shrink-0";
  if (kind === "Group") return <UsersRound className={className} aria-hidden />;
  if (kind === "Outlet") return <MapPin className={className} aria-hidden />;
  return <Building2 className={className} aria-hidden />;
}

export function ScopeSelector({
  catalog,
  request: requestOverride,
  onSelect,
}: {
  catalog: ScopeCatalog;
  /** Selection override, including a selection whose navigation is still pending. */
  request?: { client?: string | null; group?: string | null; location?: string | null };
  /** When set, the caller handles selection and navigation. */
  onSelect?: (choice: ScopeChoice) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { begin } = useFilterNavigation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [syncedOpen, setSyncedOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const request = requestOverride
    ? readScopeRequest({
        client: requestOverride.client,
        group: requestOverride.group,
        location: requestOverride.location,
      })
    : readScopeRequest({
        client: searchParams.get("client"),
        group: searchParams.get("group"),
        location: searchParams.get("location"),
      });
  const scope = resolveScope(catalog, request);
  const summary = scopeSummary(scope);
  const rows = useMemo(() => filterScopeChoices(scopeChoices(catalog), query), [catalog, query]);

  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (!open) setQuery("");
  }

  function choose(choice: ScopeChoice) {
    setOpen(false);
    if (onSelect) {
      onSelect(choice);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    writeScopeParams(params, choice);
    const next = params.toString();
    const href = next ? `${pathname}?${next}` : pathname;
    begin({ ...scopeFilterApply(choice), href }, () => router.push(href));
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-choice]");
    if (!buttons?.length) return;
    event.preventDefault();
    const target = event.key === "ArrowDown" ? buttons[0] : buttons[buttons.length - 1];
    target?.focus();
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-choice]") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? index + 1 : index - 1;
      if (next >= 0 && next < buttons.length) buttons[next]?.focus();
      else if (event.key === "ArrowUp") {
        listRef.current?.parentElement?.querySelector("input")?.focus();
      }
    }
    if (event.key === "Home") {
      event.preventDefault();
      buttons[0]?.focus();
    }
    if (event.key === "End") {
      event.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  }

  const described = summary.trail ? `${summary.eyebrow}. ${summary.title}. ${summary.trail}` : `${summary.eyebrow}. ${summary.title}`;

  const kindLabel = scopeKindLabel(summary.eyebrow);
  const locationCount = scope.locationIds.length;

  return (
    <div className="min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex h-8 max-w-full items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-left text-[13px] font-medium text-ink outline-none hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line data-popup-open:border-brand-line data-popup-open:bg-brand-tint"
          aria-label={`Scope. ${modernizeCopy(described)}`}
          title={summary.trail ? modernizeCopy(summary.trail) : undefined}
        >
          <span className="shrink-0 font-normal text-ink-3">{kindLabel}</span>
          <span className="min-w-0 truncate">{summary.title}</span>
          {scope.level !== "location" && locationCount > 0 ? (
            <span className="shrink-0 font-normal text-ink-3">· {locationCount.toLocaleString("en-US")}</span>
          ) : null}
          <ChevronDown className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(24rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0"
        >
          <div className="border-b border-line p-2">
            <label className="relative block">
              <span className="sr-only">Search businesses, groups and locations</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={`Search ${catalog.locations.length.toLocaleString("en-US")} locations, groups…`}
                className="h-[34px] w-full rounded-md border border-line bg-white pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-stone focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line"
              />
            </label>
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label="Scope"
            onKeyDown={onListKeyDown}
            className="max-h-[min(24rem,70vh)] overflow-y-auto p-1"
          >
            {catalog.locations.length === 0 && catalog.clients.length === 0 ? (
              <p className="px-3 py-6 text-sm text-ink-3">No locations yet. Import locations before choosing a scope.</p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-6 text-sm text-ink-3">Nothing matches that search.</p>
            ) : (
              rows.map((choice) => {
                const selected = choiceMatchesScope(choice, scope);
                return (
                  <button
                    key={choice.key}
                    type="button"
                    role="option"
                    data-choice=""
                    aria-selected={selected}
                    onClick={() => choose(choice)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 outline-none hover:bg-paper focus-visible:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line",
                      selected && "bg-brand-tint text-brand"
                    )}
                    style={{ paddingLeft: `${0.5 + choice.depth * 0.875}rem` }}
                  >
                    <KindIcon kind={choice.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{choice.label}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {scopeKindLabel(choice.kind)}
                        {choice.detail ? ` · ${modernizeCopy(choice.detail)}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      {scope.dropped ? (
        <p className="sr-only" role="status">
          That place is not available. Showing {scope.title}.
        </p>
      ) : null}
      {scope.blocked ? (
        <p className="sr-only" role="status">
          Your saved place is no longer in this business.
        </p>
      ) : null}
    </div>
  );
}
