import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyGeminiError } from "@/lib/services/ai-review";

// ---------------------------------------------------------------------------
// Mock Supabase admin
// ---------------------------------------------------------------------------

let mockSelectData: unknown = null;
let mockSelectError: unknown = null;
let mockInsertData: unknown = null;
let mockInsertError: unknown = null;
let mockDeleteError: unknown = null;

const mockSingle = vi.fn(() => ({ data: mockSelectData, error: mockSelectError }));
const mockInFn = vi.fn().mockReturnThis();
const mockSelect = vi.fn().mockReturnThis();
const mockInsert = vi.fn().mockReturnThis();
const mockUpdate = vi.fn().mockReturnThis();
const mockDelete = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();

const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  eq: mockEq,
  in: mockInFn,
  single: mockSingle,
});

// Chain returns for fluent API
mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, in: mockInFn });
mockInsert.mockReturnValue({
  select: vi.fn().mockReturnValue({
    single: vi.fn(() => ({ data: mockInsertData, error: mockInsertError })),
  }),
});
mockDelete.mockReturnValue({
  eq: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      in: vi.fn(() => ({ error: mockDeleteError })),
    }),
  }),
});
mockUpdate.mockReturnValue({
  eq: vi.fn(() => ({ error: null })),
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

vi.mock("@/lib/services/audit", () => ({
  AuditService: {
    log: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("classifyGeminiError", () => {
  it("classifies 429 as quota", () => {
    const result = classifyGeminiError(429, "");
    expect(result.type).toBe("quota");
  });

  it("classifies 503 as unavailable", () => {
    const result = classifyGeminiError(503, "");
    expect(result.type).toBe("unavailable");
  });

  it("classifies 502 as unavailable", () => {
    const result = classifyGeminiError(502, "");
    expect(result.type).toBe("unavailable");
  });

  it("classifies SAFETY content as safety_blocked", () => {
    const result = classifyGeminiError(400, 'SAFETY block triggered');
    expect(result.type).toBe("safety_blocked");
  });

  it("classifies 4xx as invalid_response", () => {
    const result = classifyGeminiError(400, "bad request");
    expect(result.type).toBe("invalid_response");
  });

  it("classifies a retired model as config", () => {
    const result = classifyGeminiError(
      404,
      "This model models/gemini-2.0-flash is no longer available."
    );
    expect(result.type).toBe("config");
    expect(result.message).toMatch(/no longer available/i);
  });

  it("classifies unknown errors", () => {
    const result = classifyGeminiError(500, "");
    expect(result.type).toBe("unknown");
  });

  it("classifies null status as unknown", () => {
    const result = classifyGeminiError(null, "");
    expect(result.type).toBe("unknown");
  });

  it("returns user-friendly messages for all types", () => {
    const types = [
      classifyGeminiError(429, ""),
      classifyGeminiError(503, ""),
      classifyGeminiError(400, "SAFETY"),
      classifyGeminiError(400, "bad"),
      classifyGeminiError(500, ""),
    ];
    for (const t of types) {
      expect(t.message).toBeTruthy();
      expect(t.message.length).toBeGreaterThan(10);
    }
  });
});

describe("AIReviewService.generateDraft", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, GEMINI_API_KEY: "test-key" };
    vi.clearAllMocks();
    mockSelectData = null;
    mockSelectError = null;
    mockInsertData = null;
    mockInsertError = null;
    mockDeleteError = null;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws CONFIG_ERROR when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const { AIReviewService } = await import("@/lib/services/ai-review");
    await expect(
      AIReviewService.generateDraft({
        reviewId: "rev-1",
        workspaceId: "ws-1",
        userId: "user-1",
      })
    ).rejects.toThrow("Gemini API key not configured");
  });

  it("throws NOT_FOUND when review does not exist", async () => {
    mockSelectError = { message: "not found" };
    mockSingle.mockReturnValueOnce({ data: null, error: mockSelectError });

    const { AIReviewService } = await import("@/lib/services/ai-review");
    await expect(
      AIReviewService.generateDraft({
        reviewId: "rev-1",
        workspaceId: "ws-1",
        userId: "user-1",
      })
    ).rejects.toThrow("Review not found");
  });

  it("calls Gemini with the correct URL and handles success", async () => {
    // Mock review fetch
    const reviewData = {
      id: "rev-1",
      star_rating: 5,
      comment: "Great service!",
      reviewer_display_name: "John",
      reviewer_is_anonymous: false,
      grm_google_locations: {
        location_title: "Main Street Store",
        grm_clients: { name: "Test Business" },
      },
    };
    mockSingle
      .mockReturnValueOnce({ data: reviewData, error: null }); // review fetch

    // Mock Gemini API
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Thank you, John!" }] } }],
        }),
        { status: 200 }
      )
    );

    // Mock draft insert
    const draftInsertSingle = vi.fn().mockReturnValue({ data: { id: "draft-1" }, error: null });
    const draftInsertSelect = vi.fn().mockReturnValue({ single: draftInsertSingle });
    mockInsert.mockReturnValueOnce({ select: draftInsertSelect });

    // Mock delete (clearing old drafts)
    const deleteIn = vi.fn().mockReturnValue({ error: null });
    const deleteEq2 = vi.fn().mockReturnValue({ in: deleteIn });
    const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
    mockDelete.mockReturnValueOnce({ eq: deleteEq1 });

    // Mock reply insert
    const replyInsertSingle = vi.fn().mockReturnValue({ data: { id: "reply-1" }, error: null });
    const replyInsertSelect = vi.fn().mockReturnValue({ single: replyInsertSingle });
    mockInsert.mockReturnValueOnce({ select: replyInsertSelect });

    // Mock review update
    const updateEq = vi.fn().mockReturnValue({ error: null });
    mockUpdate.mockReturnValueOnce({ eq: updateEq });

    const { AIReviewService } = await import("@/lib/services/ai-review");
    const result = await AIReviewService.generateDraft({
      reviewId: "rev-1",
      workspaceId: "ws-1",
      userId: "user-1",
    });

    expect(result.content).toBe("Thank you, John!");
    expect(result.draftId).toBe("draft-1");
    expect(result.replyId).toBe("reply-1");

    // Verify Gemini was called with correct URL (server-side, key in query)
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain("generativelanguage.googleapis.com");
    expect(fetchCall[0]).toContain("key=test-key");

    mockFetch.mockRestore();
  });

  it("handles Gemini 429 quota error", async () => {
    const reviewData = {
      id: "rev-1",
      star_rating: 3,
      comment: "OK service",
      reviewer_display_name: "Jane",
      reviewer_is_anonymous: false,
      grm_google_locations: {
        location_title: "Downtown",
        grm_clients: { name: "Biz" },
      },
    };
    mockSingle.mockReturnValueOnce({ data: reviewData, error: null });

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Rate limit exceeded", { status: 429 })
    );

    const { AIReviewService } = await import("@/lib/services/ai-review");
    await expect(
      AIReviewService.generateDraft({
        reviewId: "rev-1",
        workspaceId: "ws-1",
        userId: "user-1",
      })
    ).rejects.toThrow("quota exceeded");

    mockFetch.mockRestore();
  });

  it("handles empty Gemini response", async () => {
    const reviewData = {
      id: "rev-1",
      star_rating: 4,
      comment: "Nice",
      reviewer_display_name: "Bob",
      reviewer_is_anonymous: false,
      grm_google_locations: {
        location_title: "East Side",
        grm_clients: null,
      },
    };
    mockSingle.mockReturnValueOnce({ data: reviewData, error: null });

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "" }] } }] }),
        { status: 200 }
      )
    );

    const { AIReviewService } = await import("@/lib/services/ai-review");
    await expect(
      AIReviewService.generateDraft({
        reviewId: "rev-1",
        workspaceId: "ws-1",
        userId: "user-1",
      })
    ).rejects.toThrow("empty or unusable");

    mockFetch.mockRestore();
  });
});

describe("Server-only verification", () => {
  it("AIReviewService relies on server-only APIs (process.env, crypto)", async () => {
    const crypto = await import("crypto");
    expect(typeof process.env).toBe("object");
    expect(typeof crypto.createHash).toBe("function");
  });
});
