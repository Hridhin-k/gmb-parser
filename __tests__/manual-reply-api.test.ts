import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, AuthorizationError } from "@/lib/errors";
const m = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), edit: vi.fn(), access: vi.fn(), safe: vi.fn(), save: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/services/workspace", () => ({ ensurePersonalWorkspace: m.membership }));
vi.mock("@/lib/services/access", () => ({ assertCanEditReplyText: m.edit, assertReviewAction: m.access }));
vi.mock("@/lib/services/reply-checks", () => ({ assertSafePublicReply: m.safe }));
vi.mock("@/lib/services/manual-reply", () => ({ saveManualReply: m.save }));
vi.mock("@/lib/services/audit", () => ({ AuditService: { log: m.audit } }));
vi.mock("@/lib/db/client", () => ({ createAdminClient: () => ({ from: () => {
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { id: "review" } }) }; return chain;
} }) }));
import { POST, PUT } from "@/app/api/reviews/[reviewId]/reply/route";
const reviewId = "d8ce1062-14e5-4aee-9f30-4f74f86d705c", replyId = "cf6fd6b1-8384-4c78-a58d-9ecae7f42e52";
const context = { params: Promise.resolve({ reviewId }) };
const body = { replyId, content: "Thank you for the update. We appreciate your feedback.", expectedContent: "Earlier reply", expectedGoogleReply: "Live reply" };
const request = (method: string, value: unknown = body) => new Request(`http://localhost/api/reviews/${reviewId}/reply`, { method, body: JSON.stringify(value) });
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "user" }); m.membership.mockResolvedValue({ workspace_id: "workspace" }); m.save.mockResolvedValue({ id: replyId, status: "draft", approved_by: null }); });
describe("manual reply API", () => {
  it("saves an edit with scoped identity and the original content for conflict detection", async () => {
    const response = await PUT(request("PUT"), context);
    expect(response.status).toBe(200);
    expect(m.save).toHaveBeenCalledWith({ ...body, userId: "user", workspaceId: "workspace", reviewId });
    expect(m.access).toHaveBeenCalledWith({ userId: "user", workspaceId: "workspace", reviewId, action: "draft" });
    expect(m.safe).toHaveBeenCalledWith(expect.objectContaining({ stage: "edit", content: body.content }));
    expect(await response.json()).toMatchObject({ reply: { status: "draft", approved_by: null } });
  });
  it("can save an update for a Google-only reply without fabricating a local reply ID", async () => {
    const response = await POST(request("POST", { content: body.content, expectedGoogleReply: "Live reply" }), context);
    expect(response.status).toBe(201);
    expect(m.save).toHaveBeenCalledWith({ content: body.content, expectedGoogleReply: "Live reply", userId: "user", workspaceId: "workspace", reviewId });
  });
  it("rejects unauthenticated, AI-only and out-of-scope edits before persistence", async () => {
    m.user.mockResolvedValueOnce(null); expect((await PUT(request("PUT"), context)).status).toBe(401);
    m.edit.mockRejectedValueOnce(new AuthorizationError("Members cannot type replies")); expect((await PUT(request("PUT"), context)).status).toBe(403);
    m.access.mockRejectedValueOnce(new AuthorizationError("Outside your access")); expect((await POST(request("POST"), context)).status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("keeps guardrails and validation on edits", async () => {
    expect((await PUT(request("PUT", { ...body, content: "" }), context)).status).toBe(400);
    m.safe.mockRejectedValueOnce(new AppError("Reply is not safe", "GUARDRAIL", 422));
    expect((await PUT(request("PUT"), context)).status).toBe(422);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("returns and audits conflicts instead of claiming an update was saved", async () => {
    m.save.mockRejectedValueOnce(new AppError("The reply changed", "REPLY_CHANGED", 409));
    const response = await PUT(request("PUT"), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "The reply changed" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "reply.edit_failed", metadata: expect.objectContaining({ errorCode: "REPLY_CHANGED", replyId }) }));
  });
});
