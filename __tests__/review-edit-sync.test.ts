import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleReview } from "@/lib/types/google";
import { editSyncReachedCutoff } from "@/lib/services/review-edit-sync";
const m = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("@/lib/services/review-edit-sync", async (original) => ({ ...await original<typeof import("@/lib/services/review-edit-sync")>(), syncEditedReviews: m.sync }));
import { GET } from "@/app/api/cron/review-edits/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("edited review polling", () => {
  it("stops on update time rather than the original creation date", () => {
    const oldButEdited = { createTime: "2020-01-01T00:00:00Z", updateTime: "2026-11-06T12:00:00Z" } as GoogleReview;
    const cutoff = "2026-11-04T12:00:00Z";
    expect(editSyncReachedCutoff([oldButEdited], cutoff)).toBe(false);
    expect(editSyncReachedCutoff([{ ...oldButEdited, updateTime: cutoff }], cutoff)).toBe(false);
    expect(editSyncReachedCutoff([{ ...oldButEdited, updateTime: "2026-11-03T12:00:00Z" }], cutoff)).toBe(true);
    expect(editSyncReachedCutoff([oldButEdited], null)).toBe(false);
    expect(editSyncReachedCutoff([], cutoff)).toBe(false);
    expect(editSyncReachedCutoff([{ ...oldButEdited, updateTime: undefined }], cutoff)).toBe(false);
  });
  it("requires the configured cron secret before starting any job", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    expect((await GET(new Request("http://localhost/api/cron/review-edits"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(new Request("http://localhost/api/cron/review-edits", { headers: { authorization: "Bearer " } }))).status).toBe(401);
    expect(m.sync).not.toHaveBeenCalled();
  });
  it("reports work and failures without exposing provider details", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const req = () => new Request("http://localhost/api/cron/review-edits", { headers: { authorization: "Bearer test-secret" } });
    m.sync.mockResolvedValueOnce({ pages: 2, reviewsUpdated: 1, failures: 0 });
    expect(await (await GET(req())).json()).toMatchObject({ pages: 2, reviewsUpdated: 1 });
    m.sync.mockRejectedValueOnce(new Error("Database unavailable"));
    const response = await GET(req());
    expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty("stack");
  });
});
