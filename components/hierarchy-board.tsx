"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Building2, FolderPlus, MapPin, Search, X } from "lucide-react";
import type { HierarchyView } from "@/lib/services/hierarchy";
import { ROUTING_LEVELS } from "@/lib/hierarchy";
import { TONE_VOICES } from "@/lib/onboarding";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Panel = NonNullable<HierarchyView["selected"]>;
type Row = Panel["locations"][number];
type Brand = { id: string; name: string; count?: number };

const PAGE_SIZE = 50;

/** Native select styled like the kit's inputs; used inside FormData forms. */
const selectClass =
  "h-[34px] max-w-full rounded-md border border-line bg-white px-2.5 text-[13px] text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line disabled:opacity-60";
const labelClass = "flex flex-col gap-1.5 text-xs font-medium text-ink-2";

async function post(body: unknown): Promise<{ error: string | null; id?: string }> {
  const response = await fetch("/api/locations/hierarchy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!response.ok) return { error: payload.error ?? "That did not save." };
  return { error: null, id: payload.id };
}

function connectionBadge(connection: Row["connection"]): {
  label: string;
  variant: "ok" | "bad" | "warn" | "default";
  title: string;
} {
  switch (connection.kind) {
    case "connected":
      return { label: "Connected", variant: "ok", title: "Google access is working." };
    case "expired":
      return { label: connection.label, variant: "bad", title: "Google access expired. Reconnect the account in Settings." };
    case "duplicate":
      return { label: connection.label, variant: "warn", title: "Held: this profile looks like a duplicate of another location." };
    case "unverified":
      return { label: "Verification hold", variant: "warn", title: "Held: Google has not verified this profile, so replies can’t be published." };
    case "paused":
      return { label: "Paused", variant: "default", title: "This location is paused." };
    default:
      return { label: connection.label, variant: "bad", title: "No Google account is connected for this location." };
  }
}

function initials(label: string) {
  const name = label.split("@")[0] ?? label;
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function TreeLink({
  href,
  active,
  depth = 0,
  count,
  muted,
  className,
  children,
}: {
  href: string;
  active: boolean;
  depth?: 0 | 1 | 2;
  count?: number;
  muted?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 shrink-0 items-center justify-between gap-2 rounded-md py-1.5 pr-2.5 text-[13px] transition-colors",
        depth === 0 && "pl-2.5",
        depth === 1 && "pl-6",
        depth === 2 && "pl-9",
        active ? "bg-brand-tint font-medium text-brand" : muted ? "text-ink-3 hover:bg-paper hover:text-ink" : "text-ink-2 hover:bg-paper hover:text-ink",
        className
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined ? <span className={cn("shrink-0 text-xs tabular-nums", active ? "text-brand" : "text-ink-3")}>{count}</span> : null}
    </Link>
  );
}

function TreeHeading({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 first:pt-1">{children}</p>;
}

export function HierarchyBoard({
  canManage,
  canEditRules = false,
  brands,
  tree,
}: {
  canManage: boolean;
  canEditRules?: boolean;
  brands: Brand[];
  tree: HierarchyView;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupClientId, setGroupClientId] = useState("");
  const [groupLocationIds, setGroupLocationIds] = useState<string[]>([]);
  const [groupManagerId, setGroupManagerId] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const selectedPanel = tree.selected;

  const contextClientId =
    selectedPanel?.clientId ??
    selectedPanel?.locations.find((row) => row.clientId)?.clientId ??
    (brands.length === 1 ? brands[0].id : null);
  const attentionTotal = tree.attention.expired + tree.attention.duplicates + tree.attention.unverified;

  async function run(body: unknown, onSaved?: () => void) {
    setPending(true);
    setError(null);
    setNotice(null);
    const result = await post(body);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved?.();
    setNotice("Saved.");
    router.refresh();
  }

  function openCreate() {
    setCreating((open) => !open);
    setGroupClientId(contextClientId ?? brands[0]?.id ?? "");
    setError(null);
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Structure" className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">Structure</h2>
          {canManage ? (
            <Button type="button" size="icon-sm" variant="ghost" aria-label={creating ? "Close new group" : "New group"} onClick={openCreate}>
              {creating ? <X aria-hidden /> : <FolderPlus aria-hidden />}
            </Button>
          ) : null}
        </div>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto px-2 py-2 lg:max-h-[calc(100vh-14rem)]">
          {attentionTotal > 0 ? (
            <>
              <TreeHeading>Needs attention</TreeHeading>
              {tree.attention.expired > 0 ? (
                <TreeLink
                  href="/locations?attention=expired"
                  active={selectedPanel?.kind === "attention" && selectedPanel.id === "expired"}
                  count={tree.attention.expired}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-full bg-bad" aria-hidden />
                    Access expired
                  </span>
                </TreeLink>
              ) : null}
              {tree.attention.duplicates > 0 ? (
                <TreeLink
                  href="/locations?attention=duplicate"
                  active={selectedPanel?.kind === "attention" && selectedPanel.id === "duplicate"}
                  count={tree.attention.duplicates}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-full bg-warn" aria-hidden />
                    Possible duplicates
                  </span>
                </TreeLink>
              ) : null}
              {tree.attention.unverified > 0 ? (
                <TreeLink
                  href="/locations?attention=unverified"
                  active={selectedPanel?.kind === "attention" && selectedPanel.id === "unverified"}
                  count={tree.attention.unverified}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-full bg-warn" aria-hidden />
                    Verification holds
                  </span>
                </TreeLink>
              ) : null}
            </>
          ) : null}

          <TreeHeading>Businesses</TreeHeading>
          {tree.brands.length === 0 ? <p className="px-2.5 py-1.5 text-xs text-ink-3">No businesses yet.</p> : null}
          {tree.brands.map((brand) => {
            const brandActive = selectedPanel?.kind === "brand" && selectedPanel.id === brand.id;
            const ungroupedActive = selectedPanel?.kind === "ungrouped" && selectedPanel.id === brand.id;
            const ungroupedCount = tree.ungrouped.find((row) => row.clientId === brand.id)?.count ?? 0;
            const total = brands.find((item) => item.id === brand.id)?.count;
            return (
              <div key={brand.id} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-0.5">
                  <TreeLink href={`/locations?brand=${brand.id}`} active={brandActive} count={total} className="flex-1 shrink">
                    <span className="font-medium">{brand.name}</span>
                  </TreeLink>
                  <Link
                    href={`/businesses/${brand.id}`}
                    aria-label={`Open ${brand.name} business page`}
                    title="Open business page"
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-paper hover:text-ink"
                  >
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
                {brand.regions.map((region) => (
                  <div key={region.id} className="flex flex-col gap-0.5">
                    <TreeLink href={`/locations?group=${region.id}`} active={selectedPanel?.id === region.id} depth={1} count={region.count}>
                      {region.name}
                    </TreeLink>
                    {region.cities.map((city) => (
                      <TreeLink key={city.id} href={`/locations?group=${city.id}`} active={selectedPanel?.id === city.id} depth={2} count={city.count}>
                        {city.name}
                      </TreeLink>
                    ))}
                  </div>
                ))}
                <TreeLink href={`/locations?ungrouped=${brand.id}`} active={ungroupedActive} depth={1} count={ungroupedCount} muted>
                  Ungrouped
                </TreeLink>
              </div>
            );
          })}

          {tree.loose.length > 0 ? (
            <>
              <TreeHeading>Other groups</TreeHeading>
              {tree.loose.map((group) => (
                <TreeLink key={group.id} href={`/locations?group=${group.id}`} active={selectedPanel?.id === group.id} count={group.count}>
                  {group.name}
                </TreeLink>
              ))}
            </>
          ) : null}
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
          Groups nest one level. Reply tone, SLA and routing set on a business or group are inherited by its locations.
        </p>
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        {error ? <Banner tone="bad">{error}</Banner> : null}
        {notice ? (
          <Banner tone="ok" role="status">
            {notice}
          </Banner>
        ) : null}

        {canManage && creating ? (
          <NewGroupForm
            brands={brands}
            places={tree.places}
            members={tree.members}
            pending={pending}
            name={groupName}
            clientId={groupClientId}
            locationIds={groupLocationIds}
            managerId={groupManagerId}
            query={locationQuery}
            onName={setGroupName}
            onClient={(clientId) => {
              setGroupClientId(clientId);
              setGroupLocationIds([]);
            }}
            onQuery={setLocationQuery}
            onToggleLocation={(locationId) =>
              setGroupLocationIds((current) =>
                current.includes(locationId) ? current.filter((id) => id !== locationId) : [...current, locationId]
              )
            }
            onManager={setGroupManagerId}
            onCancel={() => setCreating(false)}
            onSubmit={() => {
              const clientId = groupClientId || contextClientId || "";
              if (!groupName.trim()) {
                setError("Enter a group name.");
                return;
              }
              if (!clientId) {
                setError("Choose a business.");
                return;
              }
              if (groupLocationIds.length === 0) {
                setError("Select at least one location.");
                return;
              }
              void (async () => {
                setPending(true);
                setError(null);
                setNotice(null);
                const result = await post({
                  action: "create-group",
                  name: groupName.trim(),
                  kind: "region",
                  clientId,
                  parentId: null,
                  locationIds: groupLocationIds,
                  managerUserId: groupManagerId || null,
                });
                setPending(false);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                setCreating(false);
                setGroupName("");
                setGroupLocationIds([]);
                setGroupManagerId("");
                setLocationQuery("");
                setNotice("Group saved.");
                if (result.id) router.push(`/locations?group=${result.id}`);
                router.refresh();
              })();
            }}
          />
        ) : null}

        {selectedPanel ? (
          <SelectedPanel
            key={`${selectedPanel.kind}:${selectedPanel.id}`}
            panel={selectedPanel}
            tree={tree}
            canManage={canManage}
            canEditRules={canEditRules}
            pending={pending}
            run={run}
            onNewGroup={canManage && !creating ? openCreate : undefined}
          />
        ) : (
          <EmptyState
            icon={Building2}
            title="Choose a business or group"
            description="Pick one on the left to see its locations, move them between groups, assign store managers and override reply rules."
          >
            {brands[0] ? (
              <Button nativeButton={false} render={<Link href={`/locations?brand=${brands[0].id}`} />}>
                <MapPin aria-hidden />
                Open {brands[0].name}
              </Button>
            ) : null}
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function SelectedPanel({
  panel,
  tree,
  canManage,
  canEditRules,
  pending,
  run,
  onNewGroup,
}: {
  panel: Panel;
  tree: HierarchyView;
  canManage: boolean;
  canEditRules: boolean;
  pending: boolean;
  run: (body: unknown, onSaved?: () => void) => Promise<void>;
  onNewGroup?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [connection, setConnection] = useState("");
  const [page, setPage] = useState(1);
  const [moveTarget, setMoveTarget] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [holdConfirm, setHoldConfirm] = useState<{ groupId: string | null; count: number } | null>(null);
  const location = panel.kind === "location" ? panel.locations[0] : null;
  const selectable = canManage && panel.kind !== "location";
  const settingsScope =
    panel.kind === "brand" ? "client" : panel.kind === "group" ? "group" : panel.kind === "location" ? "location" : null;
  const customGroups = tree.moveTargets.filter(
    (target) => !/All locations$/i.test(target.label.split(" › ").at(-1) ?? target.label)
  );

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      panel.locations.filter((row) => {
        if (connection === "connected" && row.connection.kind !== "connected") return false;
        if (connection === "problem" && !(row.connection.kind === "expired" || row.connection.kind === "unknown")) return false;
        if (connection === "hold" && !(row.connection.kind === "duplicate" || row.connection.kind === "unverified")) return false;
        if (connection === "paused" && row.connection.kind !== "paused") return false;
        if (!needle) return true;
        return [row.name, row.storeCode ?? "", row.subgroup ?? "", row.managerLabel ?? "", ...row.tags].some((value) =>
          value.toLowerCase().includes(needle)
        );
      }),
    [panel.locations, connection, needle]
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const visibleIds = visible.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selected.includes(id));
  const heldSelected = panel.locations.filter(
    (row) => selected.includes(row.id) && (row.connection.kind === "duplicate" || row.connection.kind === "unverified")
  ).length;
  const counts = {
    connected: panel.locations.filter((row) => row.connection.kind === "connected").length,
    problem: panel.locations.filter((row) => row.connection.kind === "expired" || row.connection.kind === "unknown").length,
    hold: panel.locations.filter((row) => row.connection.kind === "duplicate" || row.connection.kind === "unverified").length,
    paused: panel.locations.filter((row) => row.connection.kind === "paused").length,
  };
  const filtered = Boolean(needle || connection);

  function move(groupId: string | null) {
    if (selected.length === 0) return;
    if (heldSelected > 0) {
      setHoldConfirm({ groupId, count: heldSelected });
      return;
    }
    void run({ action: "move", locationIds: selected, groupId, confirmHold: true }, () => setSelected([]));
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-ink-3">{panel.path}</p>
            <h2 className="text-sm font-semibold text-ink">
              {panel.title} · {panel.locations.length} {panel.locations.length === 1 ? "location" : "locations"}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {panel.kind === "brand" ? (
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/businesses/${panel.id}`} />}>
                Business page
              </Button>
            ) : null}
            {canManage && panel.kind === "group" ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setRenaming((open) => !open)} aria-expanded={renaming}>
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  title="Only an empty group can be removed"
                  onClick={() => void run({ action: "remove-group", groupId: panel.id })}
                >
                  Remove if empty
                </Button>
              </>
            ) : null}
            {onNewGroup && panel.kind !== "location" ? (
              <Button size="sm" variant="outline" onClick={onNewGroup}>
                <FolderPlus aria-hidden />
                New group
              </Button>
            ) : null}
          </div>
        </div>

        {renaming && canManage && panel.kind === "group" ? (
          <form
            className="flex flex-wrap items-end gap-2 border-b border-line bg-paper px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get("name") ?? "");
              void run({ action: "rename-group", groupId: panel.id, name }, () => setRenaming(false));
            }}
          >
            <label className={cn(labelClass, "min-w-[14rem] flex-1")}>
              New name
              <Input name="name" required maxLength={120} defaultValue={panel.title} />
            </label>
            <Button type="submit" loading={pending}>
              Save name
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </form>
        ) : null}

        {panel.locations.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search name, store code, tag, manager"
                aria-label="Search locations"
                className="h-8 pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by connection">
              {(
                [
                  ["", "All", panel.locations.length],
                  ["connected", "Connected", counts.connected],
                  ["problem", "Disconnected", counts.problem],
                  ["hold", "On hold", counts.hold],
                  ["paused", "Paused", counts.paused],
                ] as const
              )
                .filter(([value, , count]) => value === "" || count > 0)
                .map(([value, label, count]) => (
                  <button
                    key={value || "all"}
                    type="button"
                    aria-pressed={connection === value}
                    onClick={() => {
                      setConnection(value);
                      setPage(1);
                    }}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
                      connection === value ? "border-brand-line bg-brand-tint text-brand" : "border-line bg-white text-ink-2 hover:bg-paper"
                    )}
                  >
                    {label}
                    <span className="tabular-nums text-ink-3">{count}</span>
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        {selectable && selected.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 bg-ink px-4 py-2 text-[13px] text-white">
            <span className="font-semibold">{selected.length} selected</span>
            <button type="button" className="text-xs text-white/70 hover:text-white" onClick={() => setSelected([])}>
              Clear
            </button>
            <span className="flex-1" />
            <label className="sr-only" htmlFor="move-target">
              Move to group
            </label>
            <select
              id="move-target"
              value={moveTarget}
              onChange={(event) => setMoveTarget(event.target.value)}
              className={cn(selectClass, "h-7 max-w-[16rem] text-xs")}
            >
              <option value="" disabled>
                Move to group…
              </option>
              {tree.moveTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" disabled={pending || !moveTarget} onClick={() => move(moveTarget)}>
              Move {selected.length}
            </Button>
            {panel.kind === "group" ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => move(null)}>
                Remove from group
              </Button>
            ) : null}
            {customGroups.length === 0 ? (
              <p className="basis-full text-xs text-white/70">No custom groups yet. Create one, then move locations into it.</p>
            ) : null}
            {heldSelected > 0 ? (
              <p className="basis-full text-xs text-white/70">
                {heldSelected} selected {heldSelected === 1 ? "is" : "are"} on hold. You’ll be asked to confirm before moving.
              </p>
            ) : null}
          </div>
        ) : null}

        {panel.locations.length === 0 ? (
          <EmptyState
            bare
            icon={MapPin}
            title={panel.kind === "ungrouped" ? "Everything is grouped" : "No locations here"}
            description={
              panel.kind === "ungrouped"
                ? "Every location in this business is already in a group."
                : panel.kind === "group"
                  ? "This group has no locations. Add some below, or remove the empty group."
                  : "Nothing needs attention in this view."
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState bare icon={Search} title="No locations match" description="Try another search or connection filter.">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setQuery("");
                setConnection("");
              }}
            >
              Clear filters
            </Button>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="bg-[#fafbfc] text-xs text-ink-3">
                <tr className="border-b border-line">
                  {selectable ? (
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        aria-label="Select all locations on this page"
                        checked={allVisibleSelected}
                        indeterminate={someVisibleSelected && !allVisibleSelected}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked
                              ? Array.from(new Set([...current, ...visibleIds]))
                              : current.filter((id) => !visibleIds.includes(id))
                          )
                        }
                      />
                    </th>
                  ) : null}
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Group</th>
                  <th className="px-3 py-2 font-medium">Manager</th>
                  <th className="px-3 py-2 font-medium">Tags</th>
                  <th className="px-3 py-2 text-right font-medium">Rating</th>
                  <th className="px-3 py-2 font-medium">Connection</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const isSelected = selected.includes(row.id);
                  const badge = connectionBadge(row.connection);
                  return (
                    <tr
                      key={row.id}
                      aria-selected={selectable ? isSelected : undefined}
                      className={cn("border-b border-line-2 last:border-0", isSelected ? "bg-brand-tint" : "hover:bg-[#fafbfd]")}
                    >
                      {selectable ? (
                        <td className="px-3 py-2.5">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) =>
                              setSelected((current) => (checked ? [...current, row.id] : current.filter((id) => id !== row.id)))
                            }
                            aria-label={`Select ${row.name}`}
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-2.5">
                        <Link className="font-semibold text-ink hover:text-brand" href={`/locations?location=${row.id}`}>
                          {row.name}
                        </Link>
                        {row.storeCode ? <span className="block text-xs text-ink-3">{row.storeCode}</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{row.subgroup || <span className="text-ink-3">Ungrouped</span>}</td>
                      <td className="px-3 py-2.5">
                        {row.managerLabel ? (
                          <span className="flex items-center gap-2 text-ink-2">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#dde3ee] text-[10px] font-semibold text-ink-2" aria-hidden>
                              {initials(row.managerLabel)}
                            </span>
                            <span className="max-w-[12rem] truncate">{row.managerLabel}</span>
                          </span>
                        ) : (
                          <span className="text-ink-3">Unassigned</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.tags.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {row.tags.map((tag) => (
                              <Badge key={tag} variant="outline">
                                {tag}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                        {row.rating === null ? "—" : <span>{row.rating.toFixed(1)} <span className="text-star">★</span></span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant={badge.variant} title={badge.title}>
                          {badge.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {row.connection.href ? (
                          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={row.connection.href} />}>
                            Reconnect
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {panel.locations.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-ink-3">
            <span>
              {rows.length === 0
                ? "0 shown"
                : `${(current - 1) * PAGE_SIZE + 1}–${Math.min(current * PAGE_SIZE, rows.length)} of ${rows.length}${filtered ? ` (filtered from ${panel.locations.length})` : ""}`}
            </span>
            {pages > 1 ? (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                  Previous
                </Button>
                <Button size="sm" variant="outline" disabled={current >= pages} onClick={() => setPage(current + 1)}>
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {canManage && panel.kind === "group" ? (
        <AddLocations
          pending={pending}
          places={tree.places.filter(
            (place) => place.clientId === panel.clientId && !panel.locations.some((row) => row.id === place.id)
          )}
          onAdd={(locationIds) => void run({ action: "move", locationIds, groupId: panel.id, confirmHold: true })}
        />
      ) : null}

      {canManage && location ? (
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-ink">Location details</h2>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-ink-2">Tags</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {location.tags.length === 0 ? <span className="text-xs text-ink-3">No tags yet.</span> : null}
              {location.tags.map((tag) => (
                <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-sm border border-line bg-white pl-2 pr-1 text-xs text-ink-2">
                  {tag}
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Remove tag ${tag}`}
                    className="flex size-4 items-center justify-center rounded text-ink-3 hover:bg-paper hover:text-ink"
                    onClick={() => void run({ action: "tags", locationId: location.id, tags: location.tags.filter((item) => item !== tag) })}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
            <TagForm
              pending={pending}
              onAdd={(next) => void run({ action: "tags", locationId: location.id, tags: [...location.tags, next] })}
            />
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const managerUserId = String(new FormData(event.currentTarget).get("managerUserId") ?? "");
              void run({ action: "manager", locationId: location.id, managerUserId: managerUserId || null });
            }}
          >
            <label className={labelClass}>
              Store manager
              <select name="managerUserId" defaultValue={location.managerUserId ?? ""} className={selectClass}>
                <option value="">No manager</option>
                {tree.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" disabled={pending}>
              Assign
            </Button>
          </form>
          {location.connection.kind === "duplicate" || location.connection.kind === "connected" || location.connection.kind === "expired" ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  void run({ action: "duplicate", locationId: location.id, duplicate: location.connection.kind !== "duplicate" })
                }
              >
                {location.connection.kind === "duplicate" ? "Clear duplicate mark" : "Mark as duplicate"}
              </Button>
              <span className="text-xs text-ink-3">A location marked as a duplicate is held until the mark is cleared.</span>
            </div>
          ) : null}
        </section>
      ) : null}

      {panel.settings ? (
        <section className="overflow-hidden rounded-lg border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">{panel.kind === "group" ? "Group settings" : "Reply rules for this place"}</h2>
            <p className="mt-0.5 text-xs text-ink-3">Each value names where it comes from. Leave a field on Inherit to use the parent’s value.</p>
          </div>
          <dl className="divide-y divide-line-2">
            {(
              [
                ["Reply tone", panel.settings.tone],
                ["Automation", panel.settings.automation],
                ["SLA", panel.settings.sla],
                ["Routing", panel.settings.routing],
              ] as const
            ).map(([label, field]) => (
              <div
                key={label}
                className={cn("flex flex-wrap items-center justify-between gap-2 px-4 py-2.5", field.overridden && "bg-brand-tint/50")}
              >
                <dt className="text-xs text-ink-3">{label}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                  <span className="font-medium">{field.value}</span>
                  {field.overridden ? <Badge variant="brand">Overridden here</Badge> : <Badge>Inherited from {field.source}</Badge>}
                </dd>
              </div>
            ))}
          </dl>
          {(canManage || canEditRules) && settingsScope ? (
            <form
              className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const tone = String(form.get("tone") ?? "");
                const sla = String(form.get("sla") ?? "");
                const routing = String(form.get("routing") ?? "");
                const drafts = String(form.get("drafts") ?? "");
                void run({
                  action: "settings",
                  scope: settingsScope,
                  targetId: panel.id,
                  toneVoice: tone || null,
                  toneNote: String(form.get("note") ?? "") || null,
                  slaHours: sla ? Number(sla) : null,
                  routingLevel: routing || null,
                  draftsPaused: drafts === "" ? null : drafts === "paused",
                });
              }}
            >
              <label className={labelClass}>
                Tone
                <select name="tone" defaultValue={panel.settings.own.toneVoice ?? ""} className={selectClass}>
                  <option value="">Inherit</option>
                  {TONE_VOICES.map((voice) => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ))}
                </select>
              </label>
              <label className={cn(labelClass, "min-w-[12rem] flex-1")}>
                Tone note
                <Input name="note" defaultValue={panel.settings.own.toneNote ?? ""} maxLength={500} />
              </label>
              <label className={labelClass}>
                SLA hours
                <Input
                  name="sla"
                  type="number"
                  min={1}
                  max={168}
                  defaultValue={panel.settings.own.slaHours ?? ""}
                  placeholder="Inherit"
                  className="w-28"
                />
              </label>
              <label className={labelClass}>
                Routing
                <select name="routing" defaultValue={panel.settings.own.routingLevel ?? ""} className={selectClass}>
                  <option value="">Inherit</option>
                  {ROUTING_LEVELS.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Drafts
                <select
                  name="drafts"
                  defaultValue={
                    panel.settings.own.draftsPaused === null ? "" : panel.settings.own.draftsPaused ? "paused" : "open"
                  }
                  className={selectClass}
                >
                  <option value="">Inherit</option>
                  <option value="paused">Paused</option>
                  <option value="open">Someone asks for a draft</option>
                </select>
              </label>
              <Button type="submit" loading={pending}>
                Save rules
              </Button>
            </form>
          ) : null}
          {canManage && panel.kind === "group" && tree.moveTargets.some((target) => target.id !== panel.id) ? (
            <form
              className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                const targetId = String(new FormData(event.currentTarget).get("targetId") ?? "");
                void run({ action: "merge-groups", sourceId: panel.id, targetId });
              }}
            >
              <label className={labelClass}>
                Merge this group into
                <select name="targetId" className={selectClass}>
                  {tree.moveTargets
                    .filter((target) => target.id !== panel.id)
                    .map((target) => (
                      <option key={target.id} value={target.id}>
                        Merge into {target.label}
                      </option>
                    ))}
                </select>
              </label>
              <Button type="submit" variant="outline" disabled={pending}>
                Merge groups
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={holdConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setHoldConfirm(null);
        }}
        title="Move locations that are on hold?"
        description={
          holdConfirm
            ? `${holdConfirm.count} of the ${selected.length} selected ${holdConfirm.count === 1 ? "location is" : "locations are"} unverified or a suspected duplicate. ${holdConfirm.groupId ? "Moving" : "Removing"} ${holdConfirm.count === 1 ? "it" : "them"} doesn’t clear the hold.`
            : ""
        }
        confirmLabel={holdConfirm?.groupId ? `Move ${selected.length}` : `Remove ${selected.length}`}
        pendingLabel="Moving…"
        onConfirm={async () => {
          if (!holdConfirm) return;
          await run({ action: "move", locationIds: selected, groupId: holdConfirm.groupId, confirmHold: true }, () => setSelected([]));
        }}
      />
    </div>
  );
}

function TagForm({ pending, onAdd }: { pending: boolean; onAdd: (tag: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = draft.trim();
        setDraft("");
        if (next) onAdd(next);
      }}
    >
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={40}
        placeholder="Add a tag"
        aria-label="Add tag"
        className="w-48"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        Add tag
      </Button>
    </form>
  );
}

function NewGroupForm({
  brands,
  places,
  members,
  pending,
  name,
  clientId,
  locationIds,
  managerId,
  query,
  onName,
  onClient,
  onQuery,
  onToggleLocation,
  onManager,
  onCancel,
  onSubmit,
}: {
  brands: Brand[];
  places: HierarchyView["places"];
  members: HierarchyView["members"];
  pending: boolean;
  name: string;
  clientId: string;
  locationIds: string[];
  managerId: string;
  query: string;
  onName: (value: string) => void;
  onClient: (value: string) => void;
  onQuery: (value: string) => void;
  onToggleLocation: (locationId: string) => void;
  onManager: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const needle = query.trim().toLowerCase();
  const choices = places.filter((place) => {
    if (place.clientId !== clientId) return false;
    if (!needle) return true;
    return place.name.toLowerCase().includes(needle) || (place.groupName ?? "").toLowerCase().includes(needle);
  });
  const chosen = places.filter((place) => locationIds.includes(place.id));
  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-brand-line bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <h2 className="text-sm font-semibold text-ink">New group</h2>
        <p className="mt-0.5 text-xs text-ink-3">Name the group, pick locations, then save. Each location stays in one group.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Group name
          <Input required maxLength={120} value={name} onChange={(event) => onName(event.target.value)} />
        </label>
        <label className={labelClass}>
          Business
          <select required value={clientId} onChange={(event) => onClient(event.target.value)} className={selectClass}>
            <option value="">Choose…</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Find a location by name or current group"
            aria-label="Find a location"
            className="pl-8"
          />
        </div>
        <ul className="flex max-h-56 flex-col overflow-y-auto rounded-md border border-line">
          {choices.length === 0 ? <li className="px-3 py-2 text-xs text-ink-3">No locations in this business match.</li> : null}
          {choices.map((place) => (
            <li key={place.id} className="border-b border-line-2 last:border-0">
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[#fafbfd]">
                <Checkbox checked={locationIds.includes(place.id)} onCheckedChange={() => onToggleLocation(place.id)} />
                <span className="min-w-0 flex-1 truncate text-ink">{place.name}</span>
                <span className="text-xs text-ink-3">{place.groupName ?? "Ungrouped"}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-ink-2">
        {chosen.length === 0
          ? "Select at least one location. Each location stays in one group, and its reviews stay on that location."
          : `${chosen.length} location${chosen.length === 1 ? "" : "s"}: ${chosen
              .slice(0, 6)
              .map((place) => place.name)
              .join(", ")}${chosen.length > 6 ? `, and ${chosen.length - 6} more` : ""}. Saving moves them into this group.`}
      </p>
      <label className={labelClass}>
        Store manager (optional)
        <select value={managerId} onChange={(event) => onManager(event.target.value)} className={cn(selectClass, "sm:max-w-xs")}>
          <option value="">No manager</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? "Saving…" : chosen.length > 0 ? `Save group with ${chosen.length}` : "Save group"}
        </Button>
      </div>
    </form>
  );
}

function AddLocations({
  places,
  pending,
  onAdd,
}: {
  places: HierarchyView["places"];
  pending: boolean;
  onAdd: (locationIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const needle = query.trim().toLowerCase();
  const choices = places.filter((place) => {
    if (!needle) return true;
    return place.name.toLowerCase().includes(needle) || (place.groupName ?? "").toLowerCase().includes(needle);
  });
  if (places.length === 0) return null;
  return (
    <details className="group overflow-hidden rounded-lg border border-line bg-white">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink">
        Add locations to this group
        <span className="text-xs font-normal text-ink-3">{places.length} available</span>
      </summary>
      <form
        className="flex flex-col gap-3 border-t border-line px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (picked.length === 0) return;
          onAdd(picked);
          setPicked([]);
        }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search locations in this business"
            aria-label="Search locations in this business"
            className="pl-8"
          />
        </div>
        <ul className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-line">
          {choices.length === 0 ? <li className="px-3 py-2 text-xs text-ink-3">No locations match.</li> : null}
          {choices.map((place) => (
            <li key={place.id} className="border-b border-line-2 last:border-0">
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[#fafbfd]">
                <Checkbox
                  checked={picked.includes(place.id)}
                  onCheckedChange={() =>
                    setPicked((current) =>
                      current.includes(place.id) ? current.filter((id) => id !== place.id) : [...current, place.id]
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate text-ink">{place.name}</span>
                <span className="text-xs text-ink-3">{place.groupName ?? "Ungrouped"}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || picked.length === 0}>
            {picked.length > 0 ? `Add ${picked.length} to this group` : "Add to this group"}
          </Button>
        </div>
      </form>
    </details>
  );
}
