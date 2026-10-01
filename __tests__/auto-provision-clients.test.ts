import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromMock, createAdminClient } = vi.hoisted(() => {
  const fromMock = vi.fn();
  return {
    fromMock,
    createAdminClient: vi.fn(() => ({ from: fromMock })),
  };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

vi.mock("@/lib/services/unassigned-client", () => ({
  UNASSIGNED_CLIENT_MARKER: "grm:system:unassigned",
  ensureUnassignedClient: vi.fn().mockResolvedValue({ id: "unassigned-1" }),
  listUnassignedClientIds: vi.fn().mockResolvedValue(["unassigned-1"]),
  isUnassignedClient: (n: string | null) => n === "grm:system:unassigned",
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  autoClientMarker,
  autoProvisionClientsFromLocations,
  isAutoClientMarker,
} from "@/lib/services/auto-provision-clients";

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  for (const m of [
    "select",
    "eq",
    "in",
    "is",
    "insert",
    "update",
    "order",
    "limit",
  ]) {
    api[m] = vi.fn(self);
  }
  api.single = vi.fn().mockResolvedValue(result);
  api.maybeSingle = vi.fn().mockResolvedValue(result);
  // Terminal for list queries (awaited thenables)
  api.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return api;
}

describe("autoClientMarker", () => {
  it("builds a stable marker from the Google location name", () => {
    const marker = autoClientMarker("accounts/1/locations/2");
    expect(marker).toBe("grm:auto:loc:accounts/1/locations/2");
    expect(isAutoClientMarker(marker)).toBe(true);
    expect(isAutoClientMarker("grm:system:unassigned")).toBe(false);
  });
});

describe("autoProvisionClientsFromLocations", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("creates a client and links each unassigned location once", async () => {
    const location = {
      id: "loc-1",
      google_location_name: "accounts/1/locations/99",
      location_title: "Acme Bakery",
      store_code: null,
      client_id: "unassigned-1",
      is_active: true,
    };

    // 1) unassigned locations .in(client_id)
    // 2) null client_id locations
    // 3) existing clients
    // 4) insert client
    // 5) update location
    const calls: unknown[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_google_locations") {
        const n = calls.filter((c) => c === "locs").length;
        calls.push("locs");
        if (n === 0) return chain({ data: [location], error: null });
        if (n === 1) return chain({ data: [], error: null });
        // link update
        return chain({ data: null, error: null });
      }
      if (table === "grm_clients") {
        const n = calls.filter((c) => c === "clients").length;
        calls.push("clients");
        if (n === 0) {
          return chain({
            data: [
              {
                id: "unassigned-1",
                name: "Unassigned",
                notes: "grm:system:unassigned",
              },
            ],
            error: null,
          });
        }
        // insert
        return chain({ data: { id: "client-new" }, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await autoProvisionClientsFromLocations("ws-1", "user-1");

    expect(result).toEqual({
      clientsCreated: 1,
      clientsReused: 0,
      locationsLinked: 1,
    });
  });

  it("reuses an existing auto-client for the same Google location", async () => {
    const marker = autoClientMarker("accounts/1/locations/99");
    const location = {
      id: "loc-1",
      google_location_name: "accounts/1/locations/99",
      location_title: "Acme Bakery",
      store_code: null,
      client_id: "unassigned-1",
      is_active: true,
    };

    const calls: string[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_google_locations") {
        const n = calls.filter((c) => c === "locs").length;
        calls.push("locs");
        if (n === 0) return chain({ data: [location], error: null });
        if (n === 1) return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      }
      if (table === "grm_clients") {
        calls.push("clients");
        return chain({
          data: [
            { id: "unassigned-1", name: "Unassigned", notes: "grm:system:unassigned" },
            { id: "client-existing", name: "Acme Bakery", notes: marker },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null });
    });

    const result = await autoProvisionClientsFromLocations("ws-1", "user-1");

    expect(result).toEqual({
      clientsCreated: 0,
      clientsReused: 1,
      locationsLinked: 1,
    });
  });

  it("returns zeros when nothing is pending", async () => {
    fromMock.mockImplementation(() => chain({ data: [], error: null }));

    const result = await autoProvisionClientsFromLocations("ws-1", "user-1");

    expect(result).toEqual({
      clientsCreated: 0,
      clientsReused: 0,
      locationsLinked: 0,
    });
  });
});
