"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { Bell, ChevronDown, LogOut, Menu, Search } from "lucide-react";
import { ActivityStatus } from "@/components/activity-status";
import { GlobalFilters } from "@/components/global-filters";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ScopeCatalog } from "@/lib/scope";
import type { ShellSummary } from "@/lib/services/shell-summary";
import { scopedHref, shellAlerts } from "@/lib/shell";
import { acknowledgeAttention } from "@/lib/attention-client";
import { createClient } from "@/lib/supabase/client";

interface ShellHeaderProps {
  user: User;
  role: string | null;
  catalog: ScopeCatalog | null;
  summary: ShellSummary;
  onOpenMenu?: () => void;
}

export function ShellHeader({ user, role, catalog, summary, onOpenMenu }: ShellHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [signingOut, setSigningOut] = useState(false);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [syncedQuery, setSyncedQuery] = useState(searchParams.get("q") ?? "");
  const initials = (user.email ?? "U").slice(0, 2).toUpperCase();
  const givenName = greetingName(user);
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

  const scope = catalog ? <GlobalFilters catalog={catalog} /> : null;

  const searchForm = (
    <form onSubmit={submitSearch} className="min-w-0 flex-1" role="search">
      <label className="relative block">
        <span className="sr-only">Search reviews</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          className="h-10 w-full min-w-0 rounded-lg border border-[#e6ebf2] bg-[#f7f9fc] pl-9 pr-3 text-sm text-graphite outline-none placeholder:text-stone focus-visible:border-[#163a7a] focus-visible:ring-2 focus-visible:ring-[#163a7a]/15"
        />
      </label>
    </form>
  );

  return (
    <header className="shrink-0 border-b border-[#e6ebf2] bg-white">
      <div className="flex flex-col gap-2 px-3 py-2 sm:px-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2 lg:contents">
        {onOpenMenu ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onOpenMenu}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1 lg:order-2 lg:ml-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-1.5 text-sm text-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#163a7a]/15"
              aria-label="Account menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-[#e8eef8] text-[11px] font-medium text-[#163a7a]">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:inline">Hi, {givenName}</span>
              <ChevronDown className="hidden size-3.5 text-slate sm:block" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-56">
              <p className="truncate px-2 py-1.5 text-xs text-slate">{user.email}</p>
              <DropdownMenuItem
                className="cursor-pointer text-sm"
                disabled={signingOut}
                onClick={() => {
                  setSigningOut(true);
                  const supabase = createClient();
                  void supabase.auth.signOut().then(() => {
                    window.location.assign("/login");
                  });
                }}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#163a7a]/15"
              aria-label={alerts.length > 0 ? `Alerts, ${alerts.length}` : "Alerts"}
            >
              <Bell className="size-4" />
              {alerts.length > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-medium text-white">
                  {alerts.length}
                </span>
              ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))]">
              {alerts.length === 0 ? (
                <p className="px-2 py-2 text-sm text-slate">Nothing needs attention right now.</p>
              ) : (
                alerts.map((alert) => (
                  <DropdownMenuItem
                    key={alert.id}
                    className="cursor-pointer whitespace-normal text-sm"
                    onClick={() => {
                      acknowledgeAttention({ kind: "alert", id: alert.id, title: alert.title });
                      router.push(alert.href);
                    }}
                  >
                    {alert.title}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {scope}
          {searchForm}
        </div>
      </div>

      {signingOut ? (
        <div className="border-t border-silver px-3 py-2 sm:px-4">
          <ActivityStatus
            title="Signing you out"
            detail="Closing this session. You will land on the sign-in page."
          />
        </div>
      ) : null}
    </header>
  );
}

function greetingName(user: User) {
  const meta = user.user_metadata as { full_name?: unknown; name?: unknown } | undefined;
  const raw = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : "";
  const fromMeta = raw.trim().split(/\s+/)[0];
  if (fromMeta) return fromMeta;
  const local = (user.email ?? "").split("@")[0]?.split(/[._+-]/)[0] ?? "";
  if (!local) return "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}
