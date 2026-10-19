import { describe, expect, it } from "vitest";
import {
  choiceMatchesScope,
  filterScopeChoices,
  locationsInScope,
  readScopeRequest,
  resolveScope,
  scopeChoices,
  scopeSummary,
  visibleCatalog,
  writeScopeParams,
  type ScopeCatalog,
  type ScopeRequest,
} from "@/lib/scope";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FAZYO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CITY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OUTLET = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function id(n: number): string {
  return `ffff${n.toString(16).padStart(4, "0")}-ffff-4fff-8fff-ffffffffffff`;
}

function fazyoCatalog(lock: ScopeCatalog["lock"]): ScopeCatalog {
  const outlets = Array.from({ length: 10 }, (_, index) => ({
    id: index === 0 ? OUTLET : id(index),
    name: `Outlet ${index + 1}`,
    clientId: FAZYO,
    groupId: index < 4 ? GROUP : null,
  }));
  return {
    workspaceId: WORKSPACE,
    workspaceName: "Explained",
    clients: [
      { id: FAZYO, name: "Fazyo" },
      { id: OTHER_CLIENT, name: "Other brand" },
    ],
    groups: [
      { id: GROUP, name: "Fazyo A", clientId: FAZYO, parentId: null },
      { id: CITY, name: "Fazyo A East", clientId: FAZYO, parentId: GROUP },
    ],
    locations: [
      ...outlets.slice(0, 3),
      { id: id(3), name: "Outlet 4", clientId: FAZYO, groupId: CITY },
      ...outlets.slice(4),
      { id: OTHER, name: "Other outlet", clientId: OTHER_CLIENT, groupId: null },
    ],
    lock,
  };
}

const openLock = { clientId: null, groupId: null, locationId: null };
const emptyRequest: ScopeRequest = { clientId: "", groupId: "", locationId: "" };

describe("organisation, group, and location membership", () => {
  const catalog = visibleCatalog({ ...fazyoCatalog(openLock) });

  it("includes every location of the organisation and only that organisation", () => {
    const scope = resolveScope(catalog, { ...emptyRequest, clientId: FAZYO });
    expect(scope.level).toBe("organisation");
    expect(scope.title).toBe("Fazyo");
    expect(scope.locationIds).toHaveLength(10);
    expect(scope.locationIds).not.toContain(OTHER);
  });

  it("includes only the locations assigned to the group, including a city under it", () => {
    const scope = resolveScope(catalog, { ...emptyRequest, groupId: GROUP });
    expect(scope.level).toBe("group");
    expect(scope.clientId).toBe(FAZYO);
    expect(locationsInScope(catalog, scope).map((location) => location.name).sort()).toEqual([
      "Outlet 1",
      "Outlet 2",
      "Outlet 3",
      "Outlet 4",
    ]);
  });

  it("includes exactly one outlet", () => {
    const scope = resolveScope(catalog, { ...emptyRequest, locationId: OUTLET });
    expect(scope.level).toBe("location");
    expect(scope.locationIds).toEqual([OUTLET]);
    expect(scope.trail).toEqual(["Fazyo", "Fazyo A", "Outlet 1"]);
  });

  it("changes the location set when the scope changes", () => {
    const organisation = resolveScope(catalog, { ...emptyRequest, clientId: FAZYO });
    const group = resolveScope(catalog, { ...emptyRequest, groupId: GROUP });
    const outlet = resolveScope(catalog, { ...emptyRequest, locationId: OUTLET });
    expect(organisation.locationIds).not.toEqual(group.locationIds);
    expect(group.locationIds).not.toEqual(outlet.locationIds);
    expect(outlet.locationIds.every((id) => group.locationIds.includes(id))).toBe(true);
    expect(group.locationIds.every((id) => organisation.locationIds.includes(id))).toBe(true);
  });
});

describe("stale, foreign, and permission scopes", () => {
  it("drops a deleted group and returns to the organisation", () => {
    const catalog = visibleCatalog(fazyoCatalog(openLock));
    const scope = resolveScope(catalog, { ...emptyRequest, clientId: FAZYO, groupId: "99999999-9999-4999-8999-999999999999" });
    expect(scope.dropped).toBe(true);
    expect(scope.level).toBe("organisation");
    expect(scope.groupId).toBeNull();
    expect(scope.locationIds).toHaveLength(10);
  });

  it("does not accept a location id from another tenant", () => {
    const catalog = visibleCatalog(fazyoCatalog(openLock));
    const scope = resolveScope(catalog, { ...emptyRequest, locationId: "abababab-abab-4aba-8aba-abababababab" });
    expect(scope.dropped).toBe(true);
    expect(scope.locationIds).not.toContain("abababab-abab-4aba-8aba-abababababab");
    expect(scope.locationId).toBeNull();
  });

  it("keeps a brand manager inside their organisation", () => {
    const catalog = visibleCatalog(fazyoCatalog({ clientId: FAZYO, groupId: null, locationId: null }));
    const scope = resolveScope(catalog, { ...emptyRequest, clientId: OTHER_CLIENT, locationId: OTHER });
    expect(scope.dropped).toBe(true);
    expect(scope.clientId).toBe(FAZYO);
    expect(scope.locationIds.every((id) => id !== OTHER)).toBe(true);
  });

  it("keeps a group manager inside their group when they ask for the whole organisation", () => {
    const catalog = visibleCatalog(fazyoCatalog({ clientId: null, groupId: GROUP, locationId: null }));
    const scope = resolveScope(catalog, emptyRequest);
    expect(scope.level).toBe("group");
    expect(scope.locationIds).toHaveLength(4);
  });

  it("keeps a store manager on their outlet", () => {
    const catalog = visibleCatalog(fazyoCatalog({ clientId: null, groupId: null, locationId: OUTLET }));
    const scope = resolveScope(catalog, { ...emptyRequest, locationId: id(8) });
    expect(scope.level).toBe("location");
    expect(scope.locationIds).toEqual([OUTLET]);
    expect(scope.dropped).toBe(true);
  });

  it("blocks queries when the saved outlet has been removed", () => {
    const catalog = visibleCatalog(fazyoCatalog({ clientId: null, groupId: null, locationId: "12121212-1212-4121-8121-121212121212" }));
    const scope = resolveScope(catalog, emptyRequest);
    expect(scope.blocked).toBe(true);
    expect(scope.locationIds).toEqual([]);
  });
});

describe("scope in the URL and beside local filters", () => {
  it("reads only uuid scope params", () => {
    expect(readScopeRequest({ client: FAZYO, group: "nope", location: OUTLET.toUpperCase() })).toEqual({
      clientId: FAZYO,
      groupId: "",
      locationId: OUTLET,
    });
  });

  it("writes the scope without clearing the date range or rating", () => {
    const params = new URLSearchParams("range=12m&rating=2&filter=draft&q=queue&page=3");
    writeScopeParams(params, { clientId: FAZYO, groupId: GROUP, locationId: null });
    expect(params.get("client")).toBe(FAZYO);
    expect(params.get("group")).toBe(GROUP);
    expect(params.get("location")).toBeNull();
    expect(params.get("range")).toBe("12m");
    expect(params.get("rating")).toBe("2");
    expect(params.get("filter")).toBe("draft");
    expect(params.get("q")).toBe("queue");
    expect(params.get("page")).toBeNull();
  });

  it("clears a group when returning to the whole organisation", () => {
    const params = new URLSearchParams(`client=${FAZYO}&group=${GROUP}&location=${OUTLET}&range=30d`);
    writeScopeParams(params, { clientId: FAZYO, groupId: null, locationId: null });
    expect(params.get("group")).toBeNull();
    expect(params.get("location")).toBeNull();
    expect(params.get("client")).toBe(FAZYO);
    expect(params.get("range")).toBe("30d");
  });
});

describe("selector rows", () => {
  it("nests outlets under their group and keeps a search hit with its parents", () => {
    const catalog = visibleCatalog(fazyoCatalog(openLock));
    const rows = scopeChoices(catalog);
    const outlet = rows.find((row) => row.locationId === OUTLET);
    expect(outlet?.parentKey).toBe(`group:${GROUP}`);
    const filtered = filterScopeChoices(rows, "Outlet 1");
    expect(filtered.map((row) => row.label)).toEqual(["Explained", "Fazyo", "Fazyo A", "Outlet 1"]);
  });

  it("marks the selected organisation, and the summary keeps context for large screens", () => {
    const catalog = visibleCatalog(fazyoCatalog(openLock));
    const scope = resolveScope(catalog, { ...emptyRequest, groupId: GROUP });
    const rows = scopeChoices(catalog);
    expect(rows.find((row) => choiceMatchesScope(row, scope))?.label).toBe("Fazyo A");
    const summary = scopeSummary(scope);
    expect(summary.eyebrow).toBe("Group");
    expect(summary.title).toBe("Fazyo A");
    expect(summary.trail).toBe("Fazyo");
  });
});
