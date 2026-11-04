import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), access: vi.fn(), scope: vi.fn(), enqueue: vi.fn(), drain: vi.fn(), views: vi.fn(), after: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/services/workspace", () => ({ ensurePersonalWorkspace: mocks.membership, assertCanSyncWorkspace: mocks.access }));
vi.mock("@/lib/services/scope-catalog", () => ({ readPageScope: mocks.scope }));
vi.mock("@/lib/services/location-pipeline", () => ({ enqueueLocationPipelines: mocks.enqueue, drainLocationPipelines: mocks.drain, pipelineJobViews: mocks.views }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), SYNC_LOCATION_LIMIT: {}, SYNC_ALL_LIMIT: {} }));

import { POST } from "@/app/api/reviews/sync/route";
import { GET } from "@/app/api/reviews/sync/status/route";

const location = "d8ce1062-14e5-4aee-9f30-4f74f86d705c";
const other = "cf6fd6b1-8384-4c78-a58d-9ecae7f42e52";
const job = "057b98f5-3228-46ac-aac1-54a95a2e757e";
const request = (body: unknown) => new Request("http://localhost/api/reviews/sync", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "user" });
  mocks.membership.mockResolvedValue({ workspace_id: "workspace" });
  mocks.scope.mockResolvedValue({ locationIds: [location] });
  mocks.enqueue.mockResolvedValue([job]);
});

describe("location sync API", () => {
  it("returns a durable job immediately and uses only selected locations", async () => {
    const response = await POST(request({ all: true, locationIds: [location] }));
    expect(response.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledWith("workspace", "user", [location], undefined);
    expect((await response.json()).jobIds).toEqual([job]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.drain).not.toHaveBeenCalled();
  });
  it("resolves the connection server-side for a single location", async () => {
    expect((await POST(request({ locationId: location }))).status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledWith("workspace", "user", [location], undefined);
  });
  it("rejects an empty selection rather than falling back to all locations", async () => {
    expect((await POST(request({ all: true, locationIds: [] }))).status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects locations outside the caller's access", async () => {
    expect((await POST(request({ all: true, locationIds: [location, other] }))).status).toBe(403);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("requires a signed-in user and permission to sync", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(request({ locationId: location }))).status).toBe(401);
    mocks.access.mockRejectedValueOnce(new AuthorizationError());
    expect((await POST(request({ locationId: location }))).status).toBe(403);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("hides a job outside the caller's current location access", async () => {
    mocks.views.mockResolvedValue([]);
    expect((await GET(new Request(`http://localhost/api/reviews/sync/status?jobId=${job}`))).status).toBe(404);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
