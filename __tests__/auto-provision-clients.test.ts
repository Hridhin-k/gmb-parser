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
  autoOrgMarker,
  autoProvisionClientsFromLocations,
  isAutoClientMarker,
  organizationNameFromTitle,
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
  api.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return api;
}

describe("organizationNameFromTitle", () => {
  it("groups Fazyo shops that only differ by store code or Google id", () => {
    expect(organizationNameFromTitle("Fazyo")).toBe("Fazyo");
    expect(organizationNameFromTitle("Fazyo (FAZ-KTYM)")).toBe("Fazyo");
    expect(organizationNameFromTitle("Fazyo (FAZ-TCR)")).toBe("Fazyo");
    expect(organizationNameFromTitle("Fazyo (06936392301318726207)")).toBe("Fazyo");
  });

  it("keeps a legal name and only strips a trailing copy suffix", () => {
    const legal =
      "Norms Management (Pvt) Ltd - ESI, PF, Labour Law Consultancy in Kerala";
    expect(organizationNameFromTitle(legal)).toBe(legal);
    expect(organizationNameFromTitle(`${legal} (2)`)).toBe(legal);
  });
});

describe("autoOrgMarker", () => {
  it("is stable for an organisation name", () => {
    const marker = autoOrgMarker("Fazyo");
    expect(marker).toBe("grm:auto:org:fazyo");
    expect(isAutoClientMarker(marker)).toBe(true);
    expect(isAutoClientMarker("grm:system:unassigned")).toBe(false);
  });
});

describe("autoProvisionClientsFromLocations", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("creates one client and links an unassigned location", async () => {
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

  it("puts every Fazyo shop on the same organisation client", async () => {
    const fazyoA = {
      id: "loc-a",
      google_location_name: "accounts/1/locations/a",
      location_title: "Fazyo",
      store_code: null,
      client_id: "unassigned-1",
      is_active: true,
    };
    const fazyoB = {
      id: "loc-b",
      google_location_name: "accounts/1/locations/b",
      location_title: "Fazyo (FAZ-KTYM)",
      store_code: "FAZ-KTYM",
      client_id: "unassigned-1",
      is_active: true,
    };

    let clientInserts = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_google_locations") {
        return chain({ data: [fazyoA, fazyoB], error: null });
      }
      if (table === "grm_clients") {
        const isList = clientInserts === 0;
        if (isList) {
          clientInserts += 1;
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
        clientInserts += 1;
        return chain({ data: { id: "client-fazyo" }, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await autoProvisionClientsFromLocations("ws-1", "user-1");

    expect(result.clientsCreated).toBe(1);
    expect(result.locationsLinked).toBe(2);
  });

  it("reuses an existing organisation client", async () => {
    const marker = autoOrgMarker("Acme Bakery");
    const location = {
      id: "loc-1",
      google_location_name: "accounts/1/locations/99",
      location_title: "Acme Bakery",
      store_code: null,
      client_id: "unassigned-1",
      is_active: true,
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "grm_google_locations") {
        return chain({ data: [location], error: null });
      }
      if (table === "grm_clients") {
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
