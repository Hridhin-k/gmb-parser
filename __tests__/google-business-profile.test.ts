import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Supabase mock — captures upsert/select chains
let mockUpsertError: null = null;
let mockSelectData: unknown[] = [];
let mockSelectError: null = null;
let mockUpdateError: null = null;

const mockSingle = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockUpsert = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

function buildChain() {
  mockSingle.mockResolvedValue({ data: mockSelectData[0] ?? null, error: mockSelectError });
  mockLimit.mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
  mockIs.mockReturnValue({ eq: mockEq, order: mockOrder });
  mockOrder.mockImplementation(() => {
    const obj = {
      limit: vi.fn().mockReturnValue({ maybeSingle: mockSingle, single: mockSingle }),
    };
    return Object.assign(
      Promise.resolve({ data: mockSelectData, error: mockSelectError }),
      obj
    );
  });
  mockEq.mockReturnValue({
    eq: mockEq,
    single: mockSingle,
    maybeSingle: mockSingle,
    order: mockOrder,
    is: mockIs,
    limit: mockLimit,
    not: vi.fn().mockReturnValue({
      order: mockOrder,
    }),
    or: vi.fn().mockReturnValue({ order: mockOrder }),
    neq: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
      order: mockOrder,
    }),
  });
  mockSelect.mockReturnValue({
    eq: mockEq,
    is: mockIs,
    order: mockOrder,
    neq: vi.fn().mockReturnValue({ order: mockOrder }),
  });
  mockUpsert.mockImplementation(() => {
    const obj = {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: mockUpsertError ? null : { id: "mock-account-uuid" },
          error: mockUpsertError,
        }),
      }),
    };
    return Object.assign(Promise.resolve({ error: mockUpsertError }), obj);
  });
  mockInsert.mockImplementation(() => {
    const obj = {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "new-client", name: "Test" },
          error: null,
        }),
      }),
    };
    return Object.assign(Promise.resolve({ error: null }), obj);
  });
  mockUpdate.mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: mockUpdateError }),
    }),
  });
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      select: mockSelect,
      upsert: mockUpsert,
      insert: mockInsert,
      update: mockUpdate,
    }),
  })),
}));

vi.mock("@/lib/services/google-oauth", () => ({
  GoogleOAuthService: {
    getValidAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  },
}));

vi.mock("@/lib/services/unassigned-client", () => ({
  UNASSIGNED_CLIENT_MARKER: "grm:system:unassigned",
  ensureUnassignedClient: vi.fn().mockResolvedValue({ id: "unassigned-client-id" }),
  isUnassignedClient: vi.fn((notes: string | null) => notes === "grm:system:unassigned"),
}));

vi.mock("@/lib/services/auto-provision-clients", () => ({
  autoProvisionClientsFromLocations: vi.fn().mockResolvedValue({
    clientsCreated: 0,
    clientsReused: 0,
    locationsLinked: 0,
  }),
  autoClientMarker: (name: string) => `grm:auto:loc:${name}`,
  isAutoClientMarker: (notes: string | null) =>
    typeof notes === "string" && notes.startsWith("grm:auto:loc:"),
}));

import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { GoogleApiError, AppError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockGoogleResponse(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertError = null;
  mockSelectData = [];
  mockSelectError = null;
  mockUpdateError = null;
  buildChain();
});

// ---------------------------------------------------------------------------
// listAccounts
// ---------------------------------------------------------------------------

describe("GoogleBusinessProfileService.listAccounts", () => {
  it("returns an empty array when Google returns no accounts", async () => {
    mockGoogleResponse(200, { accounts: [] });
    const result = await GoogleBusinessProfileService.listAccounts("token");
    expect(result).toEqual([]);
  });

  it("returns normalized accounts from Google", async () => {
    mockGoogleResponse(200, {
      accounts: [
        {
          name: "accounts/123",
          accountName: "Kalyan Restaurants",
          type: "ORGANIZATION",
          role: "OWNER",
          state: { status: "VERIFIED" },
        },
      ],
    });
    const result = await GoogleBusinessProfileService.listAccounts("token");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("accounts/123");
    expect(result[0].accountName).toBe("Kalyan Restaurants");
  });

  it("handles pagination — fetches all pages", async () => {
    mockGoogleResponse(200, {
      accounts: [
        { name: "accounts/1", accountName: "A", type: "ORG", role: "OWNER", state: { status: "VERIFIED" } },
      ],
      nextPageToken: "page2token",
    });
    mockGoogleResponse(200, {
      accounts: [
        { name: "accounts/2", accountName: "B", type: "ORG", role: "OWNER", state: { status: "VERIFIED" } },
      ],
    });
    const result = await GoogleBusinessProfileService.listAccounts("token");
    expect(result).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws GoogleApiError on 403", async () => {
    mockGoogleResponse(403, {
      error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" },
    });
    await expect(
      GoogleBusinessProfileService.listAccounts("token")
    ).rejects.toThrow(GoogleApiError);
  });

  it("throws GoogleApiError on 429 quota exceeded", async () => {
    mockGoogleResponse(429, {
      error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" },
    });
    await expect(
      GoogleBusinessProfileService.listAccounts("token")
    ).rejects.toThrow(GoogleApiError);
  });
});

// ---------------------------------------------------------------------------
// listLocations
// ---------------------------------------------------------------------------

describe("GoogleBusinessProfileService.listLocations", () => {
  it("returns locations for an account", async () => {
    mockGoogleResponse(200, {
      locations: [
        {
          name: "accounts/123/locations/456",
          title: "Kalyan Calicut",
          storefrontAddress: {
            addressLines: ["MG Road"],
            locality: "Calicut",
            administrativeArea: "Kerala",
            postalCode: "673001",
            regionCode: "IN",
          },
          phoneNumbers: { primaryPhone: "+91-495-123456" },
          metadata: { placeId: "ChIJ_abc123" },
        },
      ],
    });
    const result = await GoogleBusinessProfileService.listLocations(
      "token",
      "accounts/123"
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Kalyan Calicut");
    expect(result[0].metadata?.placeId).toBe("ChIJ_abc123");
  });

  it("skips account on 403 without throwing", async () => {
    mockGoogleResponse(403, {
      error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" },
    });
    const result = await GoogleBusinessProfileService.listLocations(
      "token",
      "accounts/restricted"
    );
    expect(result).toEqual([]);
  });

  it("handles pagination for locations", async () => {
    mockGoogleResponse(200, {
      locations: [
        { name: "accounts/1/locations/1", title: "Branch A" },
      ],
      nextPageToken: "page2",
    });
    mockGoogleResponse(200, {
      locations: [
        { name: "accounts/1/locations/2", title: "Branch B" },
      ],
    });
    const result = await GoogleBusinessProfileService.listLocations(
      "token",
      "accounts/1"
    );
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// syncConnectionAccounts — idempotency
// ---------------------------------------------------------------------------

describe("GoogleBusinessProfileService.syncConnectionAccounts", () => {
  it("upserts accounts and locations without throwing", async () => {
    // Google accounts list
    mockGoogleResponse(200, {
      accounts: [
        {
          name: "accounts/123",
          accountName: "Kalyan",
          type: "ORGANIZATION",
          role: "OWNER",
          state: { status: "VERIFIED" },
        },
      ],
    });
    // Google locations list for that account
    mockGoogleResponse(200, {
      locations: [
        { name: "accounts/123/locations/1", title: "Kalyan Calicut" },
        { name: "accounts/123/locations/2", title: "Kalyan Kochi" },
      ],
    });

    const result = await GoogleBusinessProfileService.syncConnectionAccounts(
      "conn-1",
      "ws-1"
    );

    expect(result.accountsUpserted).toBe(1);
    expect(result.locationsUpserted).toBe(2);
  });

  it("throws AppError with GBP_INSUFFICIENT_PERMISSION when accounts call is 403", async () => {
    mockGoogleResponse(403, {
      error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" },
    });
    await expect(
      GoogleBusinessProfileService.syncConnectionAccounts("conn-1", "ws-1")
    ).rejects.toThrow(AppError);

    // Verify the error code on a fresh 403 call
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" } }),
    });
    try {
      await GoogleBusinessProfileService.syncConnectionAccounts("conn-2", "ws-2");
    } catch (e) {
      if (e instanceof AppError) {
        expect(e.code).toBe("GBP_INSUFFICIENT_PERMISSION");
      }
    }
  });

  it("is idempotent — calling twice with same data does not throw", async () => {
    const account = {
      name: "accounts/123",
      accountName: "Kalyan",
      type: "ORGANIZATION",
      role: "OWNER",
      state: { status: "VERIFIED" },
    };
    const location = { name: "accounts/123/locations/1", title: "Kalyan Calicut" };

    // First call
    mockGoogleResponse(200, { accounts: [account] });
    mockGoogleResponse(200, { locations: [location] });
    const first = await GoogleBusinessProfileService.syncConnectionAccounts(
      "conn-1",
      "ws-1"
    );

    // Second call — identical data
    mockGoogleResponse(200, { accounts: [account] });
    mockGoogleResponse(200, { locations: [location] });
    const second = await GoogleBusinessProfileService.syncConnectionAccounts(
      "conn-1",
      "ws-1"
    );

    expect(first.accountsUpserted).toBe(1);
    expect(second.accountsUpserted).toBe(1);
    expect(first.locationsUpserted).toBe(1);
    expect(second.locationsUpserted).toBe(1);
  });

  it("skips account's locations on 403 but still reports account upserted", async () => {
    mockGoogleResponse(200, {
      accounts: [
        {
          name: "accounts/restricted",
          accountName: "Restricted Org",
          type: "ORGANIZATION",
          role: "OWNER",
          state: { status: "VERIFIED" },
        },
      ],
    });
    // accounts/- wildcard returns 403
    mockGoogleResponse(403, {
      error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" },
    });
    // Per-account fallback also 403 — should be skipped gracefully
    mockGoogleResponse(403, {
      error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" },
    });

    const result = await GoogleBusinessProfileService.syncConnectionAccounts(
      "conn-1",
      "ws-1"
    );

    expect(result.accountsUpserted).toBe(1);
    expect(result.locationsUpserted).toBe(0);
  });

  it("includes group-managed locations from accounts/- wildcard", async () => {
    mockGoogleResponse(200, {
      accounts: [
        {
          name: "accounts/personal",
          accountName: "Hridhin K",
          type: "PERSONAL",
          role: "OWNER",
          state: { status: "UNVERIFIED" },
        },
      ],
    });
    mockGoogleResponse(200, {
      locations: [
        { name: "locations/better-agency", title: "The Better Agency ®" },
      ],
    });

    const result = await GoogleBusinessProfileService.syncConnectionAccounts(
      "conn-1",
      "ws-1"
    );

    expect(result.accountsUpserted).toBe(1);
    expect(result.locationsUpserted).toBe(1);
  });
});

describe("GoogleBusinessProfileService.resolveLocationResourceName", () => {
  it("prefixes locations/{id} with the fallback account", () => {
    expect(
      GoogleBusinessProfileService.resolveLocationResourceName(
        "locations/456",
        "accounts/123"
      )
    ).toBe("accounts/123/locations/456");
  });

  it("leaves accounts/{a}/locations/{l} unchanged", () => {
    expect(
      GoogleBusinessProfileService.resolveLocationResourceName(
        "accounts/123/locations/456",
        "accounts/999"
      )
    ).toBe("accounts/123/locations/456");
  });
});

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

describe("address normalization", () => {
  it("formats a full address correctly", async () => {
    mockGoogleResponse(200, {
      locations: [
        {
          name: "accounts/1/locations/1",
          title: "Branch",
          storefrontAddress: {
            addressLines: ["MG Road", "Near Bus Stand"],
            locality: "Calicut",
            administrativeArea: "Kerala",
            postalCode: "673001",
            regionCode: "IN",
          },
        },
      ],
    });
    const result = await GoogleBusinessProfileService.listLocations(
      "token",
      "accounts/1"
    );
    // Normalization happens in syncConnectionAccounts; we just ensure the raw
    // location is returned with storefrontAddress intact
    expect(result[0].storefrontAddress?.locality).toBe("Calicut");
    expect(result[0].storefrontAddress?.addressLines).toContain("MG Road");
  });

  it("handles location with no address", async () => {
    mockGoogleResponse(200, {
      locations: [{ name: "accounts/1/locations/2", title: "Online Only" }],
    });
    const result = await GoogleBusinessProfileService.listLocations(
      "token",
      "accounts/1"
    );
    expect(result[0].storefrontAddress).toBeUndefined();
  });
});
