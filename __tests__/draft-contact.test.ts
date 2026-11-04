import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIReviewService } from "@/lib/services/ai-review";
import { EscalationContactStore } from "@/lib/services/escalations";
import { generateAi } from "@/lib/ai/service";
import { createAiGenerationJob } from "@/lib/services/ai-generation-jobs";

const state = vi.hoisted(() => ({ replies: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/db/client", () => ({
  createAdminClient: () => ({ from: () => {
    const chain = {
      select: () => chain, eq: () => chain,
      single: async () => ({ data: {
        id: "review-1", location_id: "location-1", star_rating: 2, comment: "The wait was long.",
        reviewer_display_name: "Asha", reviewer_is_anonymous: false,
        grm_google_locations: { location_title: "Store", grm_clients: { name: "Business" } },
        grm_review_replies: state.replies,
      }, error: null }),
    };
    return chain;
  } }),
}));
vi.mock("@/lib/ai/config", () => ({ resolveAiRoute: vi.fn(), assertAiCredentials: vi.fn() }));
vi.mock("@/lib/ai/service", () => ({ generateAi: vi.fn() }));
vi.mock("@/lib/services/escalations", () => ({ EscalationContactStore: { read: vi.fn() } }));
vi.mock("@/lib/services/audit", () => ({ AuditService: { log: vi.fn() } }));
vi.mock("@/lib/services/ai-generation-jobs", () => ({ createAiGenerationJob: vi.fn() }));
vi.mock("@/lib/services/hierarchy", () => ({ resolvedToneForLocation: vi.fn(async () => null) }));
vi.mock("@/lib/services/reply-settings", () => ({ resolvedVoiceForDraft: vi.fn(async () => ({
  tone: { greeting: "", signoff: "", warmth: "friendly", length: "brief", languages: [], neverSay: [], spellings: [] },
  automation: { varyWording: true },
})) }));
vi.mock("@/lib/services/ai-config", () => ({ loadPromptContextForLocation: vi.fn(async () => ({
  config: { version: 1, snapshot: { org: { industry: "", positioning: "", priorities: "", policies: "", legacyVoice: "", legacyNote: "" }, tone: { neverSay: [] } } }, knowledge: [], templates: [], scope: { locationId: "location-1" },
})) }));

const params = { workspaceId: "workspace-1", userId: "user-1", reviewId: "review-1" };
const contacts = { phone: "+91 98470 12345", email: "care@example.com" };
const generated = { text: "We are sorry about the wait.", model: "test-model", generationParams: {} };

describe("drafting with the saved business contact", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    state.replies = [];
    vi.mocked(EscalationContactStore.read).mockResolvedValue(contacts);
    vi.mocked(generateAi).mockResolvedValue(generated as Awaited<ReturnType<typeof generateAi>>);
    vi.spyOn(AIReviewService, "persistGeneratedDraft").mockResolvedValue({ draftId: "draft-1", replyId: "reply-1" });
  });

  it.each(["phone", "email", "both"] as const)("appends only the chosen saved contact and persists the same draft: %s", async (contact) => {
    const result = await AIReviewService.generateDraft({ ...params, contact });
    expect(result.content).toContain(generated.text);
    expect(result.content.includes(contacts.phone)).toBe(contact !== "email");
    expect(result.content.includes(contacts.email)).toBe(contact !== "phone");
    expect(EscalationContactStore.read).toHaveBeenCalledWith(params.workspaceId);
    expect(AIReviewService.persistGeneratedDraft).toHaveBeenCalledWith(expect.objectContaining({ content: result.content }));
    expect(vi.mocked(generateAi).mock.calls[0][0].prompt).not.toContain(contacts.phone);
    expect(vi.mocked(generateAi).mock.calls[0][0].prompt).not.toContain(contacts.email);
  });

  it("keeps ordinary drafting unchanged", async () => {
    const result = await AIReviewService.generateDraft(params);
    expect(result.content).toBe(generated.text);
    expect(EscalationContactStore.read).not.toHaveBeenCalled();
  });

  it.each(["phone", "email"] as const)("rejects a missing chosen %s before calling AI", async (kind) => {
    vi.mocked(EscalationContactStore.read).mockResolvedValue({ ...contacts, [kind]: null });
    await expect(AIReviewService.generateDraft({ ...params, contact: kind }))
      .rejects.toThrow("not saved for this workspace");
    expect(generateAi).not.toHaveBeenCalled();
    expect(AIReviewService.persistGeneratedDraft).not.toHaveBeenCalled();
  });

  it("does not let the AI invent a different contact when saved contacts are selected", async () => {
    vi.mocked(generateAi).mockResolvedValue({ ...generated, text: "Email invented@example.com for help." } as Awaited<ReturnType<typeof generateAi>>);
    await expect(AIReviewService.generateDraft({ ...params, contact: "both" }))
      .rejects.toThrow("Automatic replies cannot include");
    expect(AIReviewService.persistGeneratedDraft).not.toHaveBeenCalled();
  });

  it("replaces an earlier contact line without passing it back to AI", async () => {
    state.replies = [{ workspace_id: params.workspaceId, status: "draft", source: "manual",
      content: "We are sorry.\n\nYou can reach us at old@example.com so we can resolve this with you." }];
    const result = await AIReviewService.generateDraft({ ...params, replaceEdited: true, contact: "phone" });
    expect(vi.mocked(generateAi).mock.calls[0][0].prompt).not.toContain("old@example.com");
    expect(result.content).not.toContain("old@example.com");
    expect(result.content.match(/You can reach us/g)).toHaveLength(1);
  });

  it("puts the final contact-bearing content in the durable generation job", async () => {
    vi.mocked(createAiGenerationJob).mockResolvedValue("job-1");
    const result = await AIReviewService.generateDraft({ ...params, deferPersistence: true, contact: "email" });
    expect(result.persistence).toBe("pending");
    expect(createAiGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ content: result.content, workspaceId: params.workspaceId }));
    expect(result.content).toContain(contacts.email);
    expect(AIReviewService.persistGeneratedDraft).not.toHaveBeenCalled();
  });

  it("preserves a selected contact line during Shorter without asking AI to rewrite the details", async () => {
    const sentence = "You can reach us at care@example.com so we can resolve this with you.";
    state.replies = [{ workspace_id: params.workspaceId, status: "draft", source: "ai", content: `We are sorry.\n\n${sentence}` }];
    const result = await AIReviewService.generateDraft({ ...params, replaceEdited: true, adjustment: { kind: "shorter" } });
    expect(vi.mocked(generateAi).mock.calls[0][0].prompt).not.toContain(contacts.email);
    expect(result.content).toBe(`${generated.text}\n\n${sentence}`);
  });

  it("requires an explicit human request for contact drafting", async () => {
    await expect(AIReviewService.generateDraft({ ...params, automated: true, contact: "phone" }))
      .rejects.toThrow("when a person drafts");
    expect(generateAi).not.toHaveBeenCalled();
  });
});
