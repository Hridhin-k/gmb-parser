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

function KindIcon({ kind }: { kind: ScopeChoice["kind"] }) {
  const className = "size-3.5 shrink-0";
  if (kind === "Group") return <UsersRound className={className} aria-hidden />;
  if (kind === "Outlet") return <MapPin className={className} aria-hidden />;
  return <Building2 className={className} aria-hidden />;
}

export function ScopeSelector({ catalog }: { catalog: ScopeCatalog }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { begin } = useFilterNavigation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [syncedOpen, setSyncedOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const request = readScopeRequest({
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
    const params = new URLSearchParams(searchParams.toString());
    writeScopeParams(params, choice);
    const next = params.toString();
    const href = next ? `${pathname}?${next}` : pathname;
    setOpen(false);
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

  return (
    <div className="min-w-0 w-full sm:w-auto sm:min-w-[18rem] sm:max-w-md">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex w-full items-center gap-3 rounded-xl border-2 border-[#163a7a] bg-white px-3 py-2 text-left shadow-[0_1px_0_rgba(22,58,122,0.12)] outline-none hover:bg-[#f4f7fc] focus-visible:ring-2 focus-visible:ring-[#163a7a]/30"
          aria-label={`Scope. ${described}`}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#163a7a] text-white">
            <Building2 className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#163a7a]">
              {summary.eyebrow}
            </span>
            <span className="block truncate text-sm font-semibold text-ink sm:text-base">{summary.title}</span>
            {summary.trail ? (
              <span className="hidden truncate text-xs text-slate sm:block">{summary.trail}</span>
            ) : (
              <span className="hidden text-xs text-slate sm:block">
                {scope.level === "organisation" ? "All outlets" : "Selected place"}
              </span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-[#163a7a]" aria-hidden />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(24rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0"
        >
          <div className="border-b border-silver p-2">
            <label className="relative block">
              <span className="sr-only">Search organisations, groups, and outlets</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search organisations, groups, outlets"
                className="h-10 w-full rounded-lg border border-silver bg-[#f7f9fc] pl-9 pr-3 text-sm text-ink outline-none placeholder:text-stone focus-visible:border-[#163a7a] focus-visible:ring-2 focus-visible:ring-[#163a7a]/20"
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
              <p className="px-3 py-6 text-sm text-slate">No outlets yet. Import locations before choosing a scope.</p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-6 text-sm text-slate">Nothing matches that search.</p>
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
                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm outline-none hover:bg-[#f4f7fc] focus-visible:bg-[#f4f7fc] focus-visible:ring-2 focus-visible:ring-[#163a7a]/25",
                      selected && "bg-[#e8eef8]"
                    )}
                    style={{ paddingLeft: `${0.5 + choice.depth * 0.875}rem` }}
                  >
                    <KindIcon kind={choice.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{choice.label}</span>
                      <span className="block truncate text-xs text-slate">
                        {choice.kind}
                        {choice.detail ? ` · ${choice.detail}` : ""}
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
        <p className="mt-1 text-xs text-slate" role="status">
          That place is not available. Showing {scope.title}.
        </p>
      ) : null}
      {scope.blocked ? (
        <p className="mt-1 text-xs text-slate" role="status">
          Your saved place is no longer in this organisation.
        </p>
      ) : null}
    </div>
  );
}
