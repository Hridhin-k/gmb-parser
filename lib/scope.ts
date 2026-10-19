import type { ScopeIds } from "@/lib/access";
import { locationInGroup } from "@/lib/hierarchy";

/**
 * Global scope for review screens.
 *
 * The workspace is the tenant. An organisation in the selector is a client
 * (a brand the workspace manages). A group is a region or city under that
 * client. An outlet is one Google location. Reviews stay on the location;
 * the scope only chooses which locations are included.
 *
 * URL params stay `client`, `group`, and `location`. Page filters such as
 * `range`, `rating`, and `filter` are not scope.
 */

export const SCOPE_PARAM_KEYS = ["client", "group", "location"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sent to queries when the saved permission no longer points at a real place. */
export const UNAVAILABLE_SCOPE_ID = "00000000-0000-0000-0000-000000000000";

export type ScopeLevel = "organisation" | "group" | "location";

export interface ScopeClient {
  id: string;
  name: string;
}

export interface ScopeGroup {
  id: string;
  name: string;
  clientId: string | null;
  parentId: string | null;
}

export interface ScopeLocation {
  id: string;
  name: string;
  clientId: string | null;
  groupId: string | null;
}

export interface ScopeCatalog {
  workspaceId: string;
  workspaceName: string;
  clients: ScopeClient[];
  groups: ScopeGroup[];
  locations: ScopeLocation[];
  /** The signed-in member's permission. The selector cannot widen this. */
  lock: ScopeIds;
}

export interface ScopeRequest {
  clientId: string;
  groupId: string;
  locationId: string;
}

export interface ResolvedScope {
  level: ScopeLevel;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  /** Locations whose reviews, escalations, and insights belong in this scope. */
  locationIds: string[];
  title: string;
  trail: string[];
  /** A requested id was not in this workspace or not allowed. */
  dropped: boolean;
  /** The member's saved place is gone. Queries must match nothing. */
  blocked: boolean;
}

export interface ScopeChoice {
  key: string;
  parentKey: string | null;
  level: ScopeLevel;
  kind: "Organisation" | "Group" | "Outlet";
  label: string;
  detail: string;
  depth: number;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
}

export interface ScopeSummary {
  eyebrow: string;
  title: string;
  trail: string;
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

function nodes(catalog: ScopeCatalog): Array<{ id: string; parentId: string | null }> {
  return catalog.groups.map((group) => ({ id: group.id, parentId: group.parentId }));
}

function clientName(catalog: ScopeCatalog, clientId: string | null): string | null {
  if (!clientId) return null;
  return catalog.clients.find((client) => same(client.id, clientId))?.name ?? null;
}

function groupTrail(catalog: ScopeCatalog, group: ScopeGroup): string[] {
  const names: string[] = [];
  const brand = clientName(catalog, group.clientId);
  if (brand) names.push(brand);
  if (group.parentId) {
    const parent = catalog.groups.find((item) => same(item.id, group.parentId));
    if (parent) names.push(parent.name);
  }
  names.push(group.name);
  return names;
}

export function locationsInScope(catalog: ScopeCatalog, scope: Pick<ResolvedScope, "level" | "clientId" | "groupId" | "locationId">): ScopeLocation[] {
  if (scope.level === "location") {
    return catalog.locations.filter((location) => same(location.id, scope.locationId));
  }
  if (scope.level === "group" && scope.groupId) {
    return catalog.locations.filter((location) => {
      if (scope.clientId && !same(location.clientId, scope.clientId)) return false;
      return locationInGroup(location.groupId, scope.groupId, nodes(catalog));
    });
  }
  if (scope.clientId) {
    return catalog.locations.filter((location) => same(location.clientId, scope.clientId));
  }
  return catalog.locations;
}

function pack(
  catalog: ScopeCatalog,
  input: {
    level: ScopeLevel;
    clientId: string | null;
    groupId: string | null;
    locationId: string | null;
    title: string;
    trail: string[];
    dropped: boolean;
  }
): ResolvedScope {
  const locationIds = locationsInScope(catalog, input).map((location) => location.id);
  return { ...input, locationIds, blocked: false };
}

function unavailable(dropped: boolean): ResolvedScope {
  return {
    level: "organisation",
    clientId: UNAVAILABLE_SCOPE_ID,
    groupId: UNAVAILABLE_SCOPE_ID,
    locationId: UNAVAILABLE_SCOPE_ID,
    locationIds: [],
    title: "Unavailable",
    trail: ["Unavailable"],
    dropped,
    blocked: true,
  };
}

function fromLocation(catalog: ScopeCatalog, location: ScopeLocation, dropped: boolean): ResolvedScope {
  const group = location.groupId
    ? catalog.groups.find((item) => same(item.id, location.groupId)) ?? null
    : null;
  const trail = group ? groupTrail(catalog, group) : [];
  const brand = clientName(catalog, location.clientId);
  if (!group && brand) trail.push(brand);
  trail.push(location.name);
  return pack(catalog, {
    level: "location",
    clientId: location.clientId,
    groupId: null,
    locationId: location.id,
    title: location.name,
    trail,
    dropped,
  });
}

function fromGroup(catalog: ScopeCatalog, group: ScopeGroup, dropped: boolean): ResolvedScope {
  return pack(catalog, {
    level: "group",
    clientId: group.clientId,
    groupId: group.id,
    locationId: null,
    title: group.name,
    trail: groupTrail(catalog, group),
    dropped,
  });
}

function fromOrganisation(catalog: ScopeCatalog, clientId: string | null, dropped: boolean): ResolvedScope {
  const name = clientName(catalog, clientId) ?? catalog.workspaceName;
  return pack(catalog, {
    level: "organisation",
    clientId,
    groupId: null,
    locationId: null,
    title: name,
    trail: [name],
    dropped,
  });
}

function findLocation(catalog: ScopeCatalog, id: string): ScopeLocation | undefined {
  return catalog.locations.find((location) => same(location.id, id));
}

function findGroup(catalog: ScopeCatalog, id: string): ScopeGroup | undefined {
  return catalog.groups.find((group) => same(group.id, id));
}

function findClient(catalog: ScopeCatalog, id: string): ScopeClient | undefined {
  return catalog.clients.find((client) => same(client.id, id));
}

/**
 * Turn a URL into a scope the member is allowed to see.
 * Unknown, deleted, and other-tenant ids fall back to the widest allowed place.
 */
export function resolveScope(catalog: ScopeCatalog, request: ScopeRequest): ResolvedScope {
  const lock = catalog.lock;
  let dropped = false;

  if (lock.locationId) {
    const location = findLocation(catalog, lock.locationId);
    if (!location) return unavailable(true);
    if (
      (request.locationId && !same(request.locationId, location.id)) ||
      (request.groupId && !same(request.groupId, location.groupId)) ||
      (request.clientId && !same(request.clientId, location.clientId))
    ) {
      dropped = true;
    }
    return fromLocation(catalog, location, dropped);
  }

  if (lock.groupId) {
    const group = findGroup(catalog, lock.groupId);
    if (!group) return unavailable(true);
    if (request.locationId) {
      const location = findLocation(catalog, request.locationId);
      if (location && locationInGroup(location.groupId, group.id, nodes(catalog))) {
        return fromLocation(catalog, location, false);
      }
      dropped = true;
    }
    if (request.groupId && !same(request.groupId, group.id)) {
      const narrower = findGroup(catalog, request.groupId);
      if (narrower && (same(narrower.id, group.id) || same(narrower.parentId, group.id))) {
        return fromGroup(catalog, narrower, dropped);
      }
      dropped = true;
    }
    if (request.clientId && group.clientId && !same(request.clientId, group.clientId)) dropped = true;
    return fromGroup(catalog, group, dropped);
  }

  if (lock.clientId) {
    const client = findClient(catalog, lock.clientId);
    if (!client) return unavailable(true);
    if (request.locationId) {
      const location = findLocation(catalog, request.locationId);
      if (location && same(location.clientId, client.id)) return fromLocation(catalog, location, false);
      dropped = true;
    }
    if (request.groupId) {
      const group = findGroup(catalog, request.groupId);
      if (group && same(group.clientId, client.id)) return fromGroup(catalog, group, dropped);
      dropped = true;
    }
    if (request.clientId && !same(request.clientId, client.id)) dropped = true;
    return fromOrganisation(catalog, client.id, dropped);
  }

  if (request.locationId) {
    const location = findLocation(catalog, request.locationId);
    if (location) return fromLocation(catalog, location, false);
    dropped = true;
  }
  if (request.groupId) {
    const group = findGroup(catalog, request.groupId);
    if (group) return fromGroup(catalog, group, dropped);
    dropped = true;
  }
  if (request.clientId) {
    const client = findClient(catalog, request.clientId);
    if (client) return fromOrganisation(catalog, client.id, dropped);
    dropped = true;
  }
  if (catalog.clients.length === 1) return fromOrganisation(catalog, catalog.clients[0]!.id, dropped);
  return fromOrganisation(catalog, null, dropped);
}

/** Hide places the member is not allowed to open. */
export function visibleCatalog(catalog: ScopeCatalog): ScopeCatalog {
  const lock = catalog.lock;
  if (lock.locationId) {
    const location = findLocation(catalog, lock.locationId);
    const group = location?.groupId ? findGroup(catalog, location.groupId) : undefined;
    const client = location?.clientId ? findClient(catalog, location.clientId) : undefined;
    return {
      ...catalog,
      clients: client ? [client] : [],
      groups: group ? [group] : [],
      locations: location ? [location] : [],
    };
  }
  if (lock.groupId) {
    const group = findGroup(catalog, lock.groupId);
    const groups = catalog.groups.filter(
      (item) => same(item.id, lock.groupId) || same(item.parentId, lock.groupId)
    );
    const groupIds = new Set(groups.map((item) => item.id.toLowerCase()));
    const client = group?.clientId ? findClient(catalog, group.clientId) : undefined;
    return {
      ...catalog,
      clients: client ? [client] : [],
      groups,
      locations: catalog.locations.filter(
        (location) => location.groupId && groupIds.has(location.groupId.toLowerCase())
      ),
    };
  }
  if (lock.clientId) {
    return {
      ...catalog,
      clients: catalog.clients.filter((client) => same(client.id, lock.clientId)),
      groups: catalog.groups.filter((group) => same(group.clientId, lock.clientId)),
      locations: catalog.locations.filter((location) => same(location.clientId, lock.clientId)),
    };
  }
  return catalog;
}

export function readScopeRequest(source: {
  client?: string | null;
  group?: string | null;
  location?: string | null;
}): ScopeRequest {
  const id = (value?: string | null) => {
    const text = value?.trim() ?? "";
    return UUID.test(text) ? text.toLowerCase() : "";
  };
  return { clientId: id(source.client), groupId: id(source.group), locationId: id(source.location) };
}

export function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

/** Write the scope into a query string. Leaves date, rating, status, and search alone. */
export function writeScopeParams(
  params: URLSearchParams,
  choice: { clientId: string | null; groupId: string | null; locationId: string | null }
): void {
  if (choice.clientId) params.set("client", choice.clientId);
  else params.delete("client");
  if (choice.groupId) params.set("group", choice.groupId);
  else params.delete("group");
  if (choice.locationId) params.set("location", choice.locationId);
  else params.delete("location");
  params.delete("page");
}

export function scopeSummary(scope: ResolvedScope): ScopeSummary {
  const eyebrow = scope.level === "location" ? "Outlet" : scope.level === "group" ? "Group" : "Organisation";
  const trail = scope.trail.filter((part) => part !== scope.title).join(" · ");
  return { eyebrow, title: scope.title, trail };
}

export function scopeChoices(catalog: ScopeCatalog): ScopeChoice[] {
  const rows: ScopeChoice[] = [];
  const lock = catalog.lock;

  const pushLocation = (location: ScopeLocation, parentKey: string, depth: number) => {
    rows.push({
      key: `location:${location.id}`,
      parentKey,
      level: "location",
      kind: "Outlet",
      label: location.name,
      detail: location.groupId ? "Outlet" : "Outlet · no group",
      depth,
      clientId: location.clientId,
      groupId: null,
      locationId: location.id,
    });
  };

  if (lock.locationId) {
    const location = catalog.locations[0];
    if (!location) return rows;
    rows.push({
      key: `location:${location.id}`,
      parentKey: null,
      level: "location",
      kind: "Outlet",
      label: location.name,
      detail: "Only this outlet",
      depth: 0,
      clientId: location.clientId,
      groupId: null,
      locationId: location.id,
    });
    return rows;
  }

  const addGroup = (group: ScopeGroup, parentKey: string | null, depth: number) => {
    const key = `group:${group.id}`;
    rows.push({
      key,
      parentKey,
      level: "group",
      kind: "Group",
      label: group.name,
      detail: group.parentId ? "City" : "All outlets in this group",
      depth,
      clientId: group.clientId,
      groupId: group.id,
      locationId: null,
    });
    const cities = catalog.groups
      .filter((item) => same(item.parentId, group.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const city of cities) addGroup(city, key, depth + 1);
    const outlets = catalog.locations
      .filter((location) => same(location.groupId, group.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const location of outlets) pushLocation(location, key, depth + 1);
  };

  const addClient = (client: ScopeClient, parentKey: string | null, depth: number) => {
    const key = `client:${client.id}`;
    rows.push({
      key,
      parentKey,
      level: "organisation",
      kind: "Organisation",
      label: client.name,
      detail: "All outlets",
      depth,
      clientId: client.id,
      groupId: null,
      locationId: null,
    });
    const regions = catalog.groups
      .filter((group) => same(group.clientId, client.id) && !group.parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const region of regions) addGroup(region, key, depth + 1);
    const loose = catalog.locations
      .filter((location) => same(location.clientId, client.id) && !location.groupId)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const location of loose) pushLocation(location, key, depth + 1);
  };

  if (lock.groupId) {
    const root = catalog.groups.find((group) => same(group.id, lock.groupId));
    if (root) addGroup(root, null, 0);
    return rows;
  }

  const orgWide = !lock.clientId && !lock.groupId && !lock.locationId;
  if (orgWide && catalog.clients.length !== 1) {
    rows.push({
      key: "organisation",
      parentKey: null,
      level: "organisation",
      kind: "Organisation",
      label: catalog.workspaceName,
      detail: "All organisations",
      depth: 0,
      clientId: null,
      groupId: null,
      locationId: null,
    });
  }

  const clients = [...catalog.clients].sort((a, b) => a.name.localeCompare(b.name));
  for (const client of clients) {
    addClient(client, orgWide && clients.length !== 1 ? "organisation" : null, orgWide && clients.length !== 1 ? 1 : 0);
  }
  return rows;
}

function matchesQuery(value: string, needle: string): boolean {
  const hay = value.toLowerCase();
  let from = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    const next = hay[at + needle.length];
    const endsWithDigit = /\d/.test(needle[needle.length - 1] ?? "");
    if (!endsWithDigit || !next || !/\d/.test(next)) return true;
    from = at + 1;
  }
  return false;
}

export function filterScopeChoices(rows: ScopeChoice[], query: string): ScopeChoice[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const keep = new Set<string>();
  for (const row of rows) {
    if (!matchesQuery(row.label, needle) && !matchesQuery(row.detail, needle)) continue;
    let current: ScopeChoice | undefined = row;
    while (current) {
      keep.add(current.key);
      current = current.parentKey ? byKey.get(current.parentKey) : undefined;
    }
  }
  return rows.filter((row) => keep.has(row.key));
}

export function choiceMatchesScope(choice: ScopeChoice, scope: ResolvedScope): boolean {
  if (choice.level !== scope.level) return false;
  if (choice.level === "location") return same(choice.locationId, scope.locationId);
  if (choice.level === "group") return same(choice.groupId, scope.groupId);
  return same(choice.clientId, scope.clientId);
}
