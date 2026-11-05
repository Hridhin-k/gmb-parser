import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/lib/services/audit";

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));

beforeEach(() => { vi.clearAllMocks(); insert.mockResolvedValue({ error: null }); });
afterEach(() => vi.restoreAllMocks());

describe("audit persistence", () => {
  it("records background work as System and sanitizes before storage", async () => {
    await AuditService.log({ workspaceId: "workspace-a", action: "ai.request_failed", entityType: "ai_request",
      metadata: { errorCode: "AI_QUOTA", details: [{ apiKey: "private" }], inputTokens: 17 } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "workspace-a", user_id: null,
      metadata: { errorCode: "AI_QUOTA", details: [{ apiKey: "[REDACTED]" }], inputTokens: 17 } }));
  });

  it.each(["returned", "thrown"])("does not replace an operation outcome when the audit write fails (%s)", async (kind) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    if (kind === "returned") insert.mockResolvedValue({ error: { message: "private db error" } });
    else insert.mockRejectedValue(new Error("private db error"));
    await expect(AuditService.log({ workspaceId: "workspace-a", userId: "user-a", action: "reply.publish_failed", entityType: "grm_reviews" })).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("private db error");
  });
});
