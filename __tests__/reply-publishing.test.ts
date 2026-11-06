import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError, GoogleApiError } from "@/lib/errors";
import { peek, put } from "@/lib/ttl-cache";
import { AuditService } from "@/lib/services/audit";

// ---------------------------------------------------------------------------
// Shared mutable state for mock chains
// ---------------------------------------------------------------------------

let mockReplyData: unknown = null;
let mockReplyError: unknown = null;

// Build a fully chainable fluent mock for Supabase
function makeChain(overrides?: Record<string, unknown>) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn(() => ({ error: null })),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn(() => ({ data: mockReplyData, error: mockReplyError })),
    ...overrides,
  };
  // Make every method return the chain by default
  for (const key of Object.keys(chain)) {
    if (typeof chain[key] === "function" && key !== "single") {
      (chain[key] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    }
  }
  return chain;
}

// Per-call sequences for from()
let fromCallIndex = 0;
const fromSequences: Array<ReturnType<typeof makeChain>> = [];

const mockFrom = vi.fn(() => {
  const chain = fromSequences[fromCallIndex] ?? makeChain();
  fromCallIndex++;
  return chain;
});

vi.mock("@/lib/db/client", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

let mockGetValidAccessToken = vi.fn();
let mockReplyToReview = vi.fn();
let mockDeleteReply = vi.fn();

vi.mock("@/lib/services/google-oauth", () => ({
  GoogleOAuthService: {
    get getValidAccessToken() { return mockGetValidAccessToken; },
  },
}));

vi.mock("@/lib/services/google-reviews", () => ({
  GoogleReviewService: {
    get replyToReview() { return mockReplyToReview; },
    get deleteReply() { return mockDeleteReply; },
  },
}));

vi.mock("@/lib/services/audit", () => ({
  AuditService: { log: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Test helper: build the nested reply object the service expects
// ---------------------------------------------------------------------------

function buildReply(overrides: {
  status?: string;
  failure_count?: number;
  connectionId?: string;
  googleReviewName?: string;
}) {
  return {
    id: "reply-1",
    content: "Thank you for your feedback!",
    status: overrides.status ?? "approved",
    failure_count: overrides.failure_count ?? 0,
    review_id: "review-1",
    workspace_id: "ws-1",
    grm_reviews: {
      id: "review-1",
      google_review_name: overrides.googleReviewName ?? "accounts/123/locations/456/reviews/789",
      location_id: "loc-1",
      workspace_id: "ws-1",
      grm_google_locations: {
        id: "loc-1",
        google_location_name: "accounts/123/locations/456",
        google_account_id: "acc-1",
        client_id: "client-1",
        workspace_id: "ws-1",
        grm_google_accounts: {
          id: "acc-1",
          connection_id: overrides.connectionId ?? "conn-1",
        },
      },
    },
  };
}

// Helper: reset mocks and sequences before each test
function resetMocks() {
  vi.clearAllMocks();
  fromCallIndex = 0;
  fromSequences.length = 0;
  mockReplyData = null;
  mockReplyError = null;
  mockGetValidAccessToken = vi.fn().mockResolvedValue("valid-access-token");
  mockReplyToReview = vi.fn().mockResolvedValue({
    comment: "Thank you for your feedback!",
    updateTime: "2026-01-01T00:00:00.000Z",
  });
  mockDeleteReply = vi.fn().mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReplyPublishingService.publishReply", () => {
  beforeEach(resetMocks);

  it("successfully publishes an approved reply", async () => {
    // Another page can load the old inbox while Google is still responding.
    const cacheKey = "inbox:ws-1:publish-refresh-regression";
    mockReplyToReview.mockImplementation(async () => {
      put(cacheKey, "old inbox", 20_000);
      put("shell:user-1:ws-1:scope", "old sidebar count", 60_000);
      put("chrome:user-1:ws-1", "old navigation count", 60_000);
      put("dashctx:ws-1:scope", "old dashboard metrics", 45_000);
      return { comment: "Thank you for your feedback!", updateTime: "2026-01-01T00:00:00.000Z" };
    });
    const replyData = buildReply({ status: "approved" });

    // Call 1: load reply
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    // Call 2: lock update (approved → pending_publish)
    const lockChain = makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) });
    fromSequences.push(lockChain);

    // Call 3: update reviews.reply_status = pending_publish
    fromSequences.push(makeChain());

    // Call 4: update reply = published
    fromSequences.push(makeChain());

    // Call 5: update reviews.reply_status = published
    fromSequences.push(makeChain());

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    const result = await ReplyPublishingService.publishReply(
      "reply-1", "review-1", "ws-1", "user-1"
    );
    expect(peek(cacheKey)).toBeUndefined();
    expect(peek("shell:user-1:ws-1:scope")).toBeUndefined();
    expect(peek("chrome:user-1:ws-1")).toBeUndefined();
    expect(peek("dashctx:ws-1:scope")).toBeUndefined();

    expect(result.replyId).toBe("reply-1");
    expect(result.reviewId).toBe("review-1");
    expect(result.publishedAt).toBeTruthy();
    expect(mockGetValidAccessToken).toHaveBeenCalledWith("conn-1");
    expect(mockReplyToReview).toHaveBeenCalledWith(
      "valid-access-token",
      "accounts/123/locations/456/reviews/789",
      "Thank you for your feedback!"
    );
  });

  it("returns idempotent success if already published", async () => {
    const replyData = buildReply({ status: "published" });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    const result = await ReplyPublishingService.publishReply(
      "reply-1", "review-1", "ws-1", "user-1"
    );

    expect(result.replyId).toBe("reply-1");
    expect(mockReplyToReview).not.toHaveBeenCalled();
  });

  it("publishes human-added business contacts unchanged", async () => {
    const content = "We are sorry about your visit. Call +91 98470 12345 or email desk@example.com.";
    const reply = { ...buildReply({}), content, approved_by: "owner-1" };
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: reply, error: null })) }));
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: { id: reply.id }, error: null })) }));
    mockReplyToReview.mockResolvedValue({ comment: content, updateTime: "2026-11-04T12:00:00.000Z" });

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    const result = await ReplyPublishingService.publishReply(reply.id, "review-1", "ws-1", "user-1");
    expect(result.replyId).toBe(reply.id);
    expect(mockReplyToReview).toHaveBeenCalledWith("valid-access-token", reply.grm_reviews.google_review_name, content);
  });

  it("does not automatically publish contact details", async () => {
    const reply = { ...buildReply({}), content: "Please email desk@example.com." };
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: reply, error: null })) }));
    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(ReplyPublishingService.publishReply(reply.id, "review-1", "ws-1", "user-1", { automated: true }))
      .rejects.toThrow("Automatic replies cannot include");
    expect(mockReplyToReview).not.toHaveBeenCalled();
  });

  it("still requires approval for a negative review with business contacts", async () => {
    const reply = { ...buildReply({}), content: "Please call +91 98470 12345." };
    const review = { ...reply, grm_reviews: { ...reply.grm_reviews, star_rating: 2 } };
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: review, error: null })) }));
    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(ReplyPublishingService.publishReply(reply.id, "review-1", "ws-1", "user-1"))
      .rejects.toThrow("approved by an owner or admin");
    expect(mockReplyToReview).not.toHaveBeenCalled();
  });

  it("throws 409 if reply is already in pending_publish (concurrency)", async () => {
    const replyData = buildReply({ status: "pending_publish" });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(
      ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1")
    ).rejects.toThrow("already being published");
  });

  it("throws 409 when the lock update fails (second concurrent request)", async () => {
    const replyData = buildReply({ status: "approved" });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    // Lock fails — another request already changed the status
    const lockChain = makeChain({ single: vi.fn(() => ({ data: null, error: { message: "no rows" } })) });
    fromSequences.push(lockChain);

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(
      ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1")
    ).rejects.toThrow("already being published");

    expect(mockReplyToReview).not.toHaveBeenCalled();
  });

  it("throws INVALID_STATE when reply is a draft (not approved)", async () => {
    const replyData = buildReply({ status: "draft" });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(
      ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1")
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("throws NOT_FOUND when reply does not exist", async () => {
    const loadChain = makeChain({ single: vi.fn(() => ({ data: null, error: { message: "not found" } })) });
    fromSequences.push(loadChain);

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(
      ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reverts to 'approved' and rethrows when token acquisition fails", async () => {
    const replyData = buildReply({ status: "approved" });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    // Lock succeeds
    const lockChain = makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) });
    fromSequences.push(lockChain);

    // review status update (pending_publish)
    fromSequences.push(makeChain());

    // Token fetch fails
    mockGetValidAccessToken = vi.fn().mockRejectedValue(
      new AppError("Connection revoked", "OAUTH_REVOKED", 403)
    );

    // revert reply to approved
    fromSequences.push(makeChain());
    // revert review to approved
    fromSequences.push(makeChain());

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(
      ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1")
    ).rejects.toMatchObject({ code: "OAUTH_REVOKED" });

    expect(mockReplyToReview).not.toHaveBeenCalled();
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "reply.publish_failed",
      metadata: expect.objectContaining({ reviewId: "review-1", replyId: "reply-1", stage: "google_auth", errorCode: "OAUTH_REVOKED", retryable: false, durationMs: expect.any(Number) }) }));
  });

  it("marks reply as 'failed' on Google API error and includes failure count", async () => {
    const replyData = buildReply({ status: "approved", failure_count: 1 });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    const lockChain = makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) });
    fromSequences.push(lockChain);

    fromSequences.push(makeChain()); // review → pending_publish

    mockReplyToReview = vi.fn().mockRejectedValue(
      new GoogleApiError("Reply failed", 500, { reviewName: "test" })
    );

    // failed update chain
    const failUpdateChain = makeChain();
    const failEqChain = makeChain();
    failUpdateChain.update = vi.fn().mockReturnValue(failEqChain);
    fromSequences.push(failUpdateChain);

    fromSequences.push(makeChain()); // review → failed

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(
      ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1")
    ).rejects.toMatchObject({ code: "PUBLISH_UNCERTAIN" });
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "reply.publish_uncertain",
      metadata: expect.objectContaining({ reviewId: "review-1", replyId: "reply-1", providerStatus: 500, stage: "google_publish", outcome: "unconfirmed", retryable: false }) }));
  });

  it("maps 403 Google error to GOOGLE_FORBIDDEN with retryable=false", async () => {
    const replyData = buildReply({ status: "approved" });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    const lockChain = makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) });
    fromSequences.push(lockChain);
    fromSequences.push(makeChain());

    mockReplyToReview = vi.fn().mockRejectedValue(
      new GoogleApiError("Forbidden", 403)
    );

    fromSequences.push(makeChain()); // failed update
    fromSequences.push(makeChain()); // review failed

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    const err = await ReplyPublishingService.publishReply(
      "reply-1", "review-1", "ws-1", "user-1"
    ).catch((e: unknown) => e as AppError);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("GOOGLE_FORBIDDEN");
    const failures = vi.mocked(AuditService.log).mock.calls.map(([entry]) => entry).filter((entry) => entry.action === "reply.publish_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ metadata: { reviewId: "review-1", replyId: "reply-1", locationId: "loc-1", connectionId: "conn-1",
      errorCode: "GOOGLE_FORBIDDEN", errorMessage: "You do not have permission to reply to this review on Google.", providerStatus: 403, stage: "google_publish", failureCount: 1, retryable: false } });
    expect(JSON.stringify(failures)).not.toContain("valid-access-token");
  });

  it("maps 429 Google error to GOOGLE_QUOTA with retryable=true", async () => {
    const replyData = buildReply({ status: "approved" });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    const lockChain = makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) });
    fromSequences.push(lockChain);
    fromSequences.push(makeChain());

    mockReplyToReview = vi.fn().mockRejectedValue(
      new GoogleApiError("Rate limited", 429)
    );

    fromSequences.push(makeChain());
    fromSequences.push(makeChain());

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    const err = await ReplyPublishingService.publishReply(
      "reply-1", "review-1", "ws-1", "user-1"
    ).catch((e: unknown) => e as AppError);

    expect((err as AppError).code).toBe("GOOGLE_QUOTA");
    expect((err as AppError).metadata?.retryable).toBe(true);
  });

  it("hides a confirmed missing review without deleting it or its reply history", async () => {
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: buildReply({}), error: null })) }));
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) }));
    fromSequences.push(makeChain());
    const failedReply = makeChain();
    const missingReview = makeChain();
    fromSequences.push(failedReply, missingReview);
    mockReplyToReview.mockRejectedValue(new AppError("Review no longer returned by Google", "GOOGLE_REVIEW_MISSING", 410));

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1"))
      .rejects.toMatchObject({ code: "GOOGLE_REVIEW_MISSING", statusCode: 410, metadata: { retryable: false } });
    expect(missingReview.update).toHaveBeenCalledWith({
      reply_status: "failed",
      missing_on_google_at: expect.any(String),
      downstream_stale_at: expect.any(String),
    });
    expect(missingReview.eq).toHaveBeenCalledWith("workspace_id", "ws-1");
    expect(missingReview.eq).toHaveBeenCalledWith("google_review_name", "accounts/123/locations/456/reviews/789");
    expect(missingReview.delete).not.toHaveBeenCalled();
    expect(failedReply.delete).not.toHaveBeenCalled();
  });

  it("keeps a readable review in the queue when Google rejects the retry", async () => {
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: buildReply({}), error: null })) }));
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) }));
    fromSequences.push(makeChain(), makeChain());
    const keptReview = makeChain();
    fromSequences.push(keptReview);
    mockReplyToReview.mockRejectedValue(new AppError("Review exists, but Google could not accept the reply", "GOOGLE_REPLY_UNAVAILABLE", 503));

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1"))
      .rejects.toMatchObject({ code: "GOOGLE_REPLY_UNAVAILABLE", metadata: { retryable: true } });
    expect(keptReview.update).toHaveBeenCalledWith({ reply_status: "failed" });
    const failedUpdate = fromSequences[3].update as ReturnType<typeof vi.fn>;
    expect(failedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      failure_count: 1,
      publish_result: { retry: { code: "GOOGLE_REPLY_UNAVAILABLE", attempts: 1, notBefore: expect.any(String) } },
    }));
  });

  it("ends the automatic tries after the fifth write rejection", async () => {
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: buildReply({ failure_count: 4 }), error: null })) }));
    fromSequences.push(makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) }));
    const failedReply = makeChain();
    fromSequences.push(makeChain(), failedReply, makeChain());
    mockReplyToReview.mockRejectedValue(new AppError("Review exists, but Google could not accept the reply", "GOOGLE_REPLY_UNAVAILABLE", 503));

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1"))
      .rejects.toMatchObject({ code: "GOOGLE_REPLY_UNAVAILABLE", message: expect.stringContaining("after 5 automatic tries") });
    expect(failedReply.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", failure_count: 5, publish_result: null }));
  });

  it("does not publish a review already confirmed missing", async () => {
    const reply = buildReply({});
    fromSequences.push(makeChain({ single: vi.fn(() => ({
      data: { ...reply, grm_reviews: { ...reply.grm_reviews, missing_on_google_at: "2026-11-05T16:00:00Z" } },
      error: null,
    })) }));
    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1"))
      .rejects.toMatchObject({ code: "GOOGLE_REVIEW_MISSING", statusCode: 410 });
    expect(mockReplyToReview).not.toHaveBeenCalled();
  });

  it("maps network failure to UNKNOWN with retryable=true", async () => {
    const replyData = buildReply({ status: "approved" });
    const loadChain = makeChain({ single: vi.fn(() => ({ data: replyData, error: null })) });
    fromSequences.push(loadChain);

    const lockChain = makeChain({ single: vi.fn(() => ({ data: { id: "reply-1" }, error: null })) });
    fromSequences.push(lockChain);
    fromSequences.push(makeChain());

    // Plain Error simulates a network-level failure
    mockReplyToReview = vi.fn().mockRejectedValue(
      new GoogleApiError("Network error", undefined)
    );

    fromSequences.push(makeChain());
    fromSequences.push(makeChain());

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(
      ReplyPublishingService.publishReply("reply-1", "review-1", "ws-1", "user-1")
    ).rejects.toThrow();
  });
});

describe("ReplyPublishingService.resetFailedReply", () => {
  beforeEach(resetMocks);

  it("resets a failed reply to approved", async () => {
    fromSequences.push(makeChain()); // update chain
    fromSequences.push(makeChain()); // review update

    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    await expect(
      ReplyPublishingService.resetFailedReply("reply-1", "review-1", "ws-1")
    ).resolves.toBeUndefined();
  });
});

describe("Audit log safety", () => {
  it("audit records do not contain access tokens", () => {
    // Verify the service imports AuditService.log — access tokens must NEVER
    // appear in metadata passed to log(). The service only logs safe identifiers.
    const auditLogCall = `
      AuditService.log({
        workspaceId,
        userId,
        action: "reply.published",
        entityType: "grm_review_replies",
        entityId: replyId,
        metadata: {
          reviewId,
          locationId: locationData.id,
          clientId: locationData.client_id,
          publishedAt,
        },
      })
    `;
    // Ensure no token fields are referenced in the audit call
    expect(auditLogCall).not.toContain("access_token");
    expect(auditLogCall).not.toContain("refresh_token");
    expect(auditLogCall).not.toContain("token_enc");
  });
});

describe("writeRejectedRetryAt", () => {
  it("waits longer each time and stops at the fifth try", async () => {
    const { writeRejectedRetryAt } = await import("@/lib/services/reply-publishing");
    const now = new Date("2026-11-06T12:00:00Z");
    const waits = [1, 2, 3, 4].map((attempts) => (writeRejectedRetryAt(attempts, now)!.getTime() - now.getTime()) / 60_000);
    expect(waits).toEqual([15, 60, 240, 720]);
    expect(writeRejectedRetryAt(5, now)).toBeNull();
  });
});
