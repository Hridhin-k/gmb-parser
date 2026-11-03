"use client";

import { useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readScopeRequest, resolveScope, type ScopeCatalog } from "@/lib/scope";
import { modernizeCopy } from "@/lib/ui/vocabulary";

interface ShellHeaderProps {
  workspaceName: string;
  catalog: ScopeCatalog | null;
  onOpenMenu: () => void;
}

/**
 * Phone and tablet only. On wide screens the sidebar holds the place picker
 * and search, so there is no header bar at all.
 */
export function ShellHeader({ workspaceName, catalog, onOpenMenu }: ShellHeaderProps) {
  const searchParams = useSearchParams();
  const scope = catalog
    ? resolveScope(
        catalog,
        readScopeRequest({
          client: searchParams.get("client"),
          group: searchParams.get("group"),
          location: searchParams.get("location"),
        })
      )
    : null;
  const place = !scope ? null : scope.level === "organisation" && !scope.clientId ? "All businesses" : modernizeCopy(scope.title);

  return (
    <header className="shrink-0 border-b border-line bg-white lg:hidden">
      <div className="flex min-h-[52px] items-center gap-2 px-3 py-2">
        <Button type="button" variant="ghost" size="icon" onClick={onOpenMenu} aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
        <button
          type="button"
          onClick={onOpenMenu}
          className="min-w-0 flex-1 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-line"
          aria-label={`${workspaceName}${place ? `, showing ${place}` : ""}. Open navigation to change it`}
        >
          <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{workspaceName}</span>
          {place ? <span className="block truncate text-xs text-ink-3">{place}</span> : null}
        </button>
      </div>
    </header>
  );
}
