import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, AuthorizationError } from "@/lib/errors";
const mocks = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), sync: vi.fn(), audit: vi.fn(), rate: vi.fn(),
  connection: { id: "ed9ae1a4-0b7e-4c48-83f6-b57301facbf4", workspace_id: "workspace-a", status: "active" }, member: true }));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/services/workspace", () => ({ assertCanSyncWorkspace: mocks.permission }));
vi.mock("@/lib/services/google-business-profile", () => ({ GoogleBusinessProfileService: { syncConnectionAccounts: mocks.sync } }));
vi.mock("@/lib/services/audit", () => ({ AuditService: { log: mocks.audit } }));
vi.mock("@/lib/services/catalog-tables", () => ({ bustCatalogCache: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, SYNC_ALL_LIMIT: {} }));
vi.mock("@/lib/db/client", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query,
    single: async () => ({ data: table === "grm_google_connections" ? mocks.connection : mocks.member ? { workspace_id: mocks.connection.workspace_id } : null, error: null }) };
  return query;
} }) }));
import { POST } from "@/app/api/google/sync/route";
const request = () => new Request("http://localhost/api/google/sync", { method: "POST", body: JSON.stringify({ connectionId: mocks.connection.id }) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.member = true; mocks.connection.status = "active";
  mocks.user.mockResolvedValue({ id: "user-a" }); mocks.rate.mockReturnValue({ allowed: true });
  mocks.sync.mockResolvedValue({ accountsUpserted: 1, locationsUpserted: 2, skippedGoogleFetch: false });
});
describe("Google account sync authorization and diagnostics", () => {
  it("binds the sync to the authorized connection workspace and rate-limits each login separately", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.permission).toHaveBeenCalledWith("user-a", "workspace-a");
    expect(mocks.sync).toHaveBeenCalledWith(mocks.connection.id, "workspace-a", { force: false, stage: false, userId: "user-a" });
    expect(mocks.rate.mock.calls[0][1]).toBe(`google.sync_locations:${mocks.connection.id}`);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "google_sync.completed", entityId: mocks.connection.id }));
  });
  it("rejects signed-out users and connections outside membership before syncing or consuming quota", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    mocks.member = false;
    expect((await POST(request())).status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled(); expect(mocks.rate).not.toHaveBeenCalled();
  });
  it("requires owner/admin sync permission and rejects revoked connections", async () => {
    mocks.permission.mockRejectedValueOnce(new AuthorizationError());
    expect((await POST(request())).status).toBe(403);
    mocks.connection.status = "revoked";
    expect((await POST(request())).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("audits failed logins with the exact connection and safe error details", async () => {
    mocks.sync.mockRejectedValueOnce(new AppError("Reconnect required", "OAUTH_REVOKED", 401));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "google_sync.failed", entityId: mocks.connection.id,
      metadata: expect.objectContaining({ connectionId: mocks.connection.id, errorCode: "OAUTH_REVOKED", errorMessage: "Reconnect required" }) }));
  });
  it("enforces a connection's rate limit without invoking Google", async () => {
    mocks.rate.mockReturnValueOnce({ allowed: false });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
