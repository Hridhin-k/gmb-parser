"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, Check, ChevronRight, ChevronsUpDown, LayoutGrid, MapPin, Search, UsersRound } from "lucide-react";
import { ActivityStatus } from "@/components/activity-status";
import { useFilterNavigation } from "@/components/filter-navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { scopeFilterApply } from "@/lib/filter-apply";
import {
  choiceMatchesScope,
  filterScopeChoices,
  readScopeRequest,
  resolveScope,
  scopeChoices,
  writeScopeParams,
  type ScopeCatalog,
  type ScopeChoice,
} from "@/lib/scope";
import type { ShellProfileAttention } from "@/lib/shell";
import { scopeMode } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { modernizeCopy, scopeKindLabel } from "@/lib/ui/vocabulary";

const ORGANISATION_KEY = "organisation";

function KindIcon({ kind }: { kind: ScopeChoice["kind"] }) {
  const className = "size-3.5 shrink-0 text-ink-3";
  if (kind === "Group") return <UsersRound className={className} aria-hidden />;
  if (kind === "Outlet") return <MapPin className={className} aria-hidden />;
  return <Building2 className={className} aria-hidden />;
}

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** Keys of every row above `key`, nearest first. */
function ancestorsOf(key: string, byKey: Map<string, ScopeChoice>): string[] {
  const keys: string[] = [];
  let current = byKey.get(key)?.parentKey ?? null;
  while (current) {
    keys.push(current);
    current = byKey.get(current)?.parentKey ?? null;
  }
  return keys;
}

/**
 * Reviews waiting for a reply under each row. Only scoped people get
 * per-profile counts in the shell summary; everyone else sees no numbers.
 */
function waitingCounts(rows: ScopeChoice[], profiles: ShellProfileAttention[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (profiles.length === 0) return counts;
  const byLocation = new Map(profiles.map((profile) => [profile.id, profile.unreplied]));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const row of rows) {
    if (row.level !== "location" || !row.locationId) continue;
    const value = byLocation.get(row.locationId) ?? 0;
    if (value === 0) continue;
    for (const key of [row.key, ...ancestorsOf(row.key, byKey)]) {
      counts.set(key, (counts.get(key) ?? 0) + value);
    }
  }
  return counts;
}

export interface PlacePickerProps {
  catalog: ScopeCatalog | null;
  workspaceName: string;
  workspaces: Array<{ id: string; name: string }>;
  activeWorkspaceId: string;
  logoUrl?: string | null;
  profiles: ShellProfileAttention[];
  /** Where to land when a place is chosen on a page that does not follow the place. */
  home: string;
  canManageLocations: boolean;
  onNavigate?: () => void;
}

/**
 * The one control for choosing a business, group or location. It sits at the
 * top of the sidebar and writes `client`, `group` and `location` to the URL;
 * every page that follows the place reads them with `readPageScope`.
 */
export function PlacePicker({
  catalog,
  workspaceName,
  workspaces,
  activeWorkspaceId,
  logoUrl,
  profiles,
  home,
  canManageLocations,
  onNavigate,
}: PlacePickerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applying, begin } = useFilterNavigation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"places" | "workspaces">("places");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const switching = saving || refreshing;

  // Read the selection still in flight, so a second pick does not undo the first.
  const params = new URLSearchParams(
    applying && applying.href.split("?")[0] === pathname ? (applying.href.split("?")[1] ?? "") : searchParams.toString()
  );
  const request = readScopeRequest({
    client: params.get("client"),
    group: params.get("group"),
    location: params.get("location"),
  });
  const scope = catalog ? resolveScope(catalog, request) : null;
  const allRows = useMemo(() => (catalog ? scopeChoices(catalog) : []), [catalog]);
  const byKey = useMemo(() => new Map(allRows.map((row) => [row.key, row])), [allRows]);
  const parents = useMemo(() => new Set(allRows.map((row) => row.parentKey).filter(Boolean) as string[]), [allRows]);
  const counts = useMemo(() => waitingCounts(allRows, profiles), [allRows, profiles]);
  const organisation = byKey.get(ORGANISATION_KEY) ?? null;
  const selected = scope ? allRows.find((row) => choiceMatchesScope(row, scope)) ?? null : null;

  // Open the branch that holds the current place; after that the person decides.
  const openKeys = expanded ?? new Set(selected ? ancestorsOf(selected.key, byKey) : []);
  const searching = query.trim().length > 0;
  const rows = (searching ? filterScopeChoices(allRows, query) : allRows).filter((row) => {
    if (row.key === ORGANISATION_KEY) return false;
    if (searching) return true;
    return ancestorsOf(row.key, byKey).every((key) => key === ORGANISATION_KEY || openKeys.has(key));
  });
  const depthOffset = organisation ? 1 : 0;

  const placeTitle = !scope ? "Workspace" : scope.level === "organisation" && !scope.clientId ? "All businesses" : modernizeCopy(scope.title);
  const scoped = Boolean(scope && (scope.clientId || scope.groupId || scope.locationId) && organisation);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setView("places");
    }
  }

  function toggle(key: string) {
    const next = new Set(openKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  }

  function choose(choice: ScopeChoice) {
    onOpenChange(false);
    onNavigate?.();
    // Pages such as Settings do not follow the place, so open Today there instead.
    const followsPlace = scopeMode(pathname) !== "none";
    const base = followsPlace ? pathname : home.split("?")[0] ?? home;
    const next = followsPlace ? new URLSearchParams(params) : new URLSearchParams(home.split("?")[1] ?? "");
    writeScopeParams(next, choice);
    next.delete("focusFrom");
    next.delete("focusTo");
    const qs = next.toString();
    const href = qs ? `${base}?${qs}` : base;
    begin({ ...scopeFilterApply({ kind: scopeKindLabel(choice.kind), label: choice.label }), href }, () =>
      router.push(href, { scroll: false })
    );
  }

  async function chooseWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    onOpenChange(false);
    setSaving(true);
    try {
      const response = await fetch("/api/workspace/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!response.ok) return;
      // /overview bounces roles that cannot open it (members) to their own home.
      startRefresh(() => {
        router.push("/overview");
        router.refresh();
      });
    } finally {
      setSaving(false);
    }
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-choice]");
    if (!buttons?.length) return;
    event.preventDefault();
    (event.key === "ArrowDown" ? buttons[0] : buttons[buttons.length - 1])?.focus();
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-choice]") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? index + 1 : index - 1;
      if (next >= 0 && next < buttons.length) buttons[next]?.focus();
      else if (event.key === "ArrowUp") listRef.current?.parentElement?.querySelector("input")?.focus();
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const key = buttons[index]?.dataset.choice;
      if (!key || !parents.has(key) || searching) return;
      const isOpen = openKeys.has(key);
      if ((event.key === "ArrowRight" && !isOpen) || (event.key === "ArrowLeft" && isOpen)) {
        event.preventDefault();
        toggle(key);
      }
    }
  }

  const mark = logoUrl ? (
    // The agency supplied this URL. It is shown only after they save it.
    <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
      {workspaceName.trim().charAt(0).toUpperCase() || "R"}
    </span>
  );

  const multipleWorkspaces = workspaces.length > 1;
  const businessCount = catalog?.clients.length ?? 0;
  const locationCount = catalog?.locations.length ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          className="flex min-h-[52px] w-full items-center gap-2.5 rounded-[10px] border border-line bg-white p-2 text-left outline-none hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line data-popup-open:border-brand-line data-popup-open:bg-brand-tint/40"
          aria-label={`${workspaceName}, showing ${placeTitle}. Choose a business or location`}
          disabled={switching}
        >
          {mark}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{workspaceName}</span>
            <span className={cn("block truncate text-xs", scoped ? "font-semibold text-brand" : "text-ink-3")}>{placeTitle}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-ink-3" aria-hidden />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(21.5rem,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0"
        >
          {view === "workspaces" ? (
            <>
              <div className="flex items-center gap-1 border-b border-line p-2">
                <button
                  type="button"
                  onClick={() => setView("places")}
                  className="flex size-8 items-center justify-center rounded-md text-ink-2 outline-none hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line"
                  aria-label="Back to places"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                </button>
                <p className="text-[13px] font-semibold text-ink">Switch workspace</p>
              </div>
              <div className="max-h-[min(24rem,60vh)] overflow-y-auto p-1">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => void chooseWorkspace(workspace.id)}
                    className="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-ink-2 outline-none hover:bg-paper focus-visible:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{workspace.name}</span>
                    {workspace.id === activeWorkspaceId ? <Check className="size-4 text-brand" aria-label="Current" /> : null}
                  </button>
                ))}
              </div>
              <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-ink-3">
                Switching changes your team, permissions and settings. To narrow what you see, pick a business or location instead.
              </p>
            </>
          ) : (
            <>
              {catalog ? (
                <div className="border-b border-line p-2">
                  <label className="relative block">
                    <span className="sr-only">Find a business or location</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={onSearchKeyDown}
                      placeholder="Find a business or location"
                      className="h-9 w-full rounded-md border border-line bg-white pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-stone focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line"
                    />
                  </label>
                </div>
              ) : null}
              <div
                ref={listRef}
                role="listbox"
                aria-label="Businesses and locations"
                onKeyDown={onListKeyDown}
                className="max-h-[min(28rem,65vh)] overflow-y-auto p-1"
              >
                {!catalog || (catalog.locations.length === 0 && catalog.clients.length === 0) ? (
                  <p className="px-3 py-6 text-[13px] text-ink-3">No locations yet. Import your Google locations to choose one here.</p>
                ) : (
                  <>
                    {organisation && !searching ? (
                      <button
                        type="button"
                        role="option"
                        data-choice={organisation.key}
                        aria-selected={selected?.key === organisation.key}
                        onClick={() => choose(organisation)}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-paper focus-visible:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line",
                          selected?.key === organisation.key && "bg-brand-tint"
                        )}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-paper text-ink-2">
                          <LayoutGrid className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-ink">All businesses</span>
                          <span className="block truncate text-xs text-ink-3">
                            {plural(businessCount, "business", "businesses")} · {plural(locationCount, "location", "locations")}
                          </span>
                        </span>
                        {counts.get(organisation.key) ? <WaitingCount value={counts.get(organisation.key)!} /> : null}
                        {selected?.key === organisation.key ? <Check className="size-4 shrink-0 text-brand" aria-hidden /> : null}
                      </button>
                    ) : null}
                    {rows.length === 0 ? (
                      <p className="px-3 py-6 text-center text-[13px] text-ink-3">Nothing called “{query.trim()}”.</p>
                    ) : (
                      rows.map((choice) => {
                        const isSelected = selected?.key === choice.key;
                        const canExpand = !searching && parents.has(choice.key);
                        const isOpen = openKeys.has(choice.key);
                        const depth = searching ? 0 : Math.max(choice.depth - depthOffset, 0);
                        const waiting = counts.get(choice.key) ?? 0;
                        return (
                          <div key={choice.key} className="flex items-center gap-0.5" style={{ paddingLeft: `${depth * 1.125}rem` }}>
                            {canExpand ? (
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => toggle(choice.key)}
                                aria-label={`${isOpen ? "Hide" : "Show"} places in ${choice.label}`}
                                aria-expanded={isOpen}
                                className="flex h-9 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 outline-none hover:bg-paper hover:text-ink"
                              >
                                <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} aria-hidden />
                              </button>
                            ) : (
                              <span className="w-7 shrink-0" aria-hidden />
                            )}
                            <button
                              type="button"
                              role="option"
                              data-choice={choice.key}
                              aria-selected={isSelected}
                              onClick={() => choose(choice)}
                              className={cn(
                                "flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left outline-none hover:bg-paper focus-visible:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line",
                                isSelected && "bg-brand-tint"
                              )}
                            >
                              <KindIcon kind={choice.kind} />
                              <span className="min-w-0 flex-1">
                                <span className={cn("block truncate text-[13px] text-ink", choice.kind === "Organisation" ? "font-semibold" : "font-medium")}>
                                  {choice.label}
                                </span>
                                <span className="block truncate text-[11px] text-ink-3">
                                  {scopeKindLabel(choice.kind)}
                                  {choice.detail && choice.kind !== "Outlet" ? ` · ${modernizeCopy(choice.detail)}` : ""}
                                </span>
                              </span>
                              {waiting ? <WaitingCount value={waiting} /> : null}
                              {isSelected ? <Check className="size-4 shrink-0 text-brand" aria-hidden /> : null}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
              {multipleWorkspaces || canManageLocations ? (
                <div className="flex items-center justify-between gap-2 border-t border-line bg-paper/60 px-2 py-1">
                  {multipleWorkspaces ? (
                    <button
                      type="button"
                      onClick={() => setView("workspaces")}
                      className="rounded-md px-2 py-2 text-xs font-medium text-ink-2 outline-none hover:bg-white hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-line"
                    >
                      Switch workspace
                    </button>
                  ) : (
                    <span />
                  )}
                  {canManageLocations ? (
                    <Link
                      href="/locations"
                      onClick={() => {
                        onOpenChange(false);
                        onNavigate?.();
                      }}
                      className="rounded-md px-2 py-2 text-xs font-medium text-brand outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-line"
                    >
                      Manage locations
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </PopoverContent>
      </Popover>
      {switching ? (
        <ActivityStatus title="Opening that workspace" detail="Loading its businesses, reviews and Google connections." />
      ) : null}
      {scope?.dropped ? (
        <p className="sr-only" role="status">
          That place is not available. Showing {placeTitle}.
        </p>
      ) : null}
      {scope?.blocked ? (
        <p className="sr-only" role="status">
          Your saved place is no longer in this business.
        </p>
      ) : null}
    </div>
  );
}

function WaitingCount({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums",
        value >= 10 ? "bg-bad-tint text-bad" : "bg-paper text-ink-2"
      )}
      title="Reviews waiting for a reply"
      aria-label={`${value.toLocaleString("en-US")} waiting for a reply`}
    >
      {value > 999 ? `${Math.floor(value / 1000)}k` : value.toLocaleString("en-US")}
    </span>
  );
}
