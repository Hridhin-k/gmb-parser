import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIReviewService, buildReplyPrompt, draftModelRoute, isDetailedReview } from "@/lib/services/ai-review";
import { adjustmentInstruction } from "@/lib/reply-adjustments";
import { voiceGuide, TONE_DEFAULTS } from "@/lib/automation";
const m = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/services/workspace", () => ({ ensurePersonalWorkspace: m.membership }));
vi.mock("@/lib/services/access", () => ({ assertReviewAction: m.access }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), AI_GENERATE_LIMIT: {}, WORKSPACE_AI_LIMIT: {} }));
import { POST } from "@/app/api/reviews/[reviewId]/generate/route";
const base = { reviewerName: "Asha", starRating: 4, businessName: "QA shop", locationName: "QA branch" };
const long = "We spent the afternoon choosing clothes for a family event. The team helped us compare several fabrics and sizes and found outfits for everyone. The selection was excellent and the fitting area was clean. We appreciated that nobody rushed us while we were deciding. The billing queue was slow, and the parking entrance was difficult to find. Clearer signs and a quicker checkout would have made the visit easier. We would still return because the advice was helpful and the final choices worked well for the event. Thank you to everyone who took the time to help us get the right fit, rather than just trying to make a quick sale.";
beforeEach(() => { m.user.mockResolvedValue({ id: "user" }); m.membership.mockResolvedValue({ workspace_id: "workspace" }); });
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe("thoughtful review replies", () => {
  it("requests specific coverage and proportionate length, while keeping safety and language", () => {
    const prompt = buildReplyPrompt({ ...base, comment: long, adjustment: { kind: "thoughtful" }, currentDraft: "Thanks for visiting." });
    expect(prompt).toContain("MORE THOUGHTFUL"); expect(prompt).toContain("5–8 complete sentences");
    expect(prompt).toContain("main praise, concerns and questions specifically");
    expect(prompt).toContain("Preserve the current draft's language and script");
    expect(prompt).toContain("Never offer refunds"); expect(prompt).toContain("Do not pad a short or rating-only review");
    expect(draftModelRoute({ starRating: 5, comment: "Great", adjustmentKind: "thoughtful" })).toBe("full");
  });
  it("gives long first drafts room, respects an explicitly brief preference and counts only the original review", () => {
    expect(isDetailedReview(long)).toBe(true);
    expect(buildReplyPrompt({ ...base, comment: long })).toContain("5–8 complete sentences");
    expect(buildReplyPrompt({ ...base, comment: long, lengthPreference: "brief" })).toContain("1–2 short sentences, covering the key feedback");
    expect(isDetailedReview(`Good service\n\n(Translated by Google)\n${long}`)).toBe(false);
    expect(buildReplyPrompt({ ...base, comment: null })).toContain("1–2 short sentences");
    expect(buildReplyPrompt({ ...base, comment: long, adjustment: { kind: "shorter" } })).not.toContain("5–8 complete sentences");
  });
  it("omits conflicting voice length caps while retaining brand style and full review/draft context", () => {
    const guide = voiceGuide({ ...TONE_DEFAULTS, length: "brief", neverSay: ["amazing"] }, false, { omitLength: true });
    expect(guide).not.toContain("one or two"); expect(guide).toContain("Never say: amazing");
    const tail = "The final concern was parking access.";
    expect(buildReplyPrompt({ ...base, comment: `${long.repeat(7)} ${tail}` })).toContain(tail);
    expect(adjustmentInstruction({ kind: "thoughtful" }, `${"a".repeat(1700)} ${tail}`)).toContain(tail);
  });
  it("accepts the new API action with contact selection, using scoped identity", async () => {
    const generate = vi.spyOn(AIReviewService, "generateDraft").mockResolvedValue({ content: "A considered response", replyId: "reply", draftId: "draft" });
    const reviewId = "d8ce1062-14e5-4aee-9f30-4f74f86d705c";
    const response = await POST(new Request("http://localhost/generate", { method: "POST", body: JSON.stringify({ adjustment: "thoughtful", replaceEdited: true, contact: "both" }) }), { params: Promise.resolve({ reviewId }) });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ reviewId, workspaceId: "workspace", userId: "user", adjustment: { kind: "thoughtful" }, replaceEdited: true, contact: "both", deferPersistence: true }));
  });
});
