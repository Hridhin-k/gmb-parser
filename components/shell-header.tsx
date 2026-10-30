"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import { GlobalFilters } from "@/components/global-filters";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ScopeCatalog } from "@/lib/scope";
import type { ShellSummary } from "@/lib/services/shell-summary";
import { scopeMode, scopedHref, shellAlerts } from "@/lib/shell";

interface ShellHeaderProps {
  role: string | null;
  catalog: ScopeCatalog | null;
  summary: ShellSummary;
  onOpenMenu?: () => void;
}

export function ShellHeader({ role, catalog, summary, onOpenMenu }: ShellHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [syncedQuery, setSyncedQuery] = useState(searchParams.get("q") ?? "");
  const alerts = shellAlerts(summary, role).map((alert) => ({
    ...alert,
    href: alert.id === "more-profiles" ? alert.href : scopedHref(alert.href, searchParams, pathname),
  }));
  if (syncedQuery !== (searchParams.get("q") ?? "")) {
    const next = searchParams.get("q") ?? "";
    setSyncedQuery(next);
    setSearch(next);
  }

  function writeParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  useEffect(() => {
    if (pathname !== "/reviews" && pathname !== "/escalations") return;
    const current = searchParams.get("q") ?? "";
    if (search.trim() === current) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const query = search.trim();
      if (query) params.set("q", query);
      else params.delete("q");
      params.delete("page");
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    }, 320);
    return () => window.clearTimeout(handle);
  }, [search, pathname, router, searchParams]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = search.trim();
    if (pathname === "/reviews" || pathname === "/escalations") {
      writeParams((params) => {
        if (query) params.set("q", query);
        else params.delete("q");
      });
      return;
    }
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const client = searchParams.get("client");
    if (client) params.set("client", client);
    const href = scopedHref(`/reviews${params.size ? `?${params}` : ""}`, searchParams, pathname);
    router.push(href);
  }

  // Scope pills appear only on pages whose content they affect.
  const mode = scopeMode(pathname);
  const scope = catalog && mode !== "none" ? <GlobalFilters catalog={catalog} showDate={mode === "client-range"} /> : null;

  return (
    <header className="shrink-0 border-b border-line bg-white">
      <div className="flex min-h-[52px] flex-wrap items-center gap-2 px-3 py-2 sm:px-5">
        {onOpenMenu ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onOpenMenu}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </Button>
        ) : null}

        <div className="order-3 flex w-full min-w-0 items-center sm:order-none sm:w-auto sm:flex-1">{scope}</div>

        <form onSubmit={submitSearch} className="ml-auto min-w-0 flex-1 sm:max-w-[320px] sm:flex-none" role="search">
          <label className="relative block">
            <span className="sr-only">Search reviews</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reviews, reviewers, text…"
              className="h-[34px] w-full min-w-0 rounded-md border border-line bg-white pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line sm:w-[300px]"
            />
          </label>
        </form>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="relative flex size-[34px] shrink-0 items-center justify-center rounded-md text-ink-2 outline-none hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line"
            aria-label={alerts.length > 0 ? `Needs attention, ${alerts.length}` : "Notifications"}
          >
            <Bell className="size-4" />
            {alerts.length > 0 ? (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">
                {alerts.length}
              </span>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))]">
            <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Needs attention</p>
            {alerts.length === 0 ? (
              <p className="px-2 pb-2 text-[13px] text-ink-3">Nothing needs attention right now.</p>
            ) : (
              alerts.map((alert) => (
                <DropdownMenuItem
                  key={alert.id}
                  className="cursor-pointer whitespace-normal text-[13px]"
                  onClick={() => {
                    void (async () => {
                      if (alert.id.startsWith("notice:")) {
                        const noticeId = alert.id.slice("notice:".length);
                        await fetch(`/api/notifications/${noticeId}/read`, { method: "POST" }).catch(() => null);
                      }
                      router.push(alert.href);
                    })();
                  }}
                >
                  {alert.title}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
