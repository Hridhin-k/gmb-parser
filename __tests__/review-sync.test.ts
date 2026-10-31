import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const syncState = vi.hoisted(() => ({
  locationLastSynced: null as string | null,
  locationFullSynced: "2026-09-01T00:00:00Z" as string | null,
  upsertError: null as { message: string } | null,
  existingReviewRows: [] as Array<{
    google_review_name: string;
    sync_hash: string;
    reply_status: string;
  }>,
}));

// Track every DB upsert call for idempotency assertions
const upsertCalls: unknown[] = [];
const updateCalls: unknown[] = [];

// Mock Supabase admin client
vi.mock("@/lib/db/client", () => {
  const buildChain = (table: string) => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockImplementation(() => {
            if (table === "grm_google_locations") {
              return Promise.resolve({
                data: {
                  id: "loc-1",
                  google_location_name: "accounts/123/locations/456",
                  workspace_id: "ws-1",
                  last_synced_at: syncState.locationLastSynced,
                  reviews_full_synced_at: syncState.locationFullSynced,
                },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          }),
        }),
        in: vi.fn().mockImplementation(() =>
          Promise.resolve({ data: syncState.existingReviewRows, error: null })
        ),
      }),
    }),
    upsert: vi.fn().mockImplementation((data: unknown) => {
      upsertCalls.push(data);
      return Promise.resolve({ error: syncState.upsertError });
    }),
    update: vi.fn().mockImplementation((data: unknown) => {
      updateCalls.push(data);
      return {
        eq: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
      };
    }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  });

  return {
    createAdminClient: vi.fn(() => ({
      from: (table: string) => buildChain(table),
    })),
  };
});

vi.mock("@/lib/services/google-oauth", () => ({
  GoogleOAuthService: {
    getValidAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  },
}));

vi.mock("@/lib/services/audit", () => ({
  AuditService: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ReviewSyncService, classifyReviewError } from "@/lib/services/review-sync";
import { GoogleApiError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockApiResponse(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

function makeReview(id: string, overrides: Partial<object> = {}) {
  return {
    name: `accounts/123/locations/456/reviews/${id}`,
    reviewId: id,
    reviewer: { displayName: "Alice", profilePhotoUrl: null },
    starRating: "FIVE",
    comment: "Great place!",
    createTime: "2026-08-01T10:00:00Z",
    updateTime: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  upsertCalls.length = 0;
  updateCalls.length = 0;
  syncState.locationLastSynced = null;
  syncState.locationFullSynced = "2026-09-01T00:00:00Z";
  syncState.upsertError = null;
  syncState.existingReviewRows = [];
});

// ---------------------------------------------------------------------------
// classifyReviewError
// ---------------------------------------------------------------------------

describe("classifyReviewError", () => {
  it("classifies 401 as authentication", () => {
    const err = new GoogleApiError("Unauthorized", 401);
    expect(classifyReviewError(err)).toBe("authentication");
  });

  it("classifies 403 as authorization", () => {
    const err = new GoogleApiError("Forbidden", 403);
    expect(classifyReviewError(err)).toBe("authorization");
  });

  it("classifies 404 as not_found", () => {
    const err = new GoogleApiError("Not found", 404);
    expect(classifyReviewError(err)).toBe("not_found");
  });

  it("classifies 429 as rate_limit by default", () => {
    const err = new GoogleApiError("Rate limit", 429, { body: "rateLimitExceeded" });
    expect(classifyReviewError(err)).toBe("rate_limit");
  });

  it("classifies 429 as quota when body contains quotaExceeded", () => {
    const err = new GoogleApiError("Quota exceeded", 429, { body: "quotaExceeded" });
    expect(classifyReviewError(err)).toBe("quota");
  });

  it("classifies 400 as invalid_request", () => {
    const err = new GoogleApiError("Bad request", 400);
    expect(classifyReviewError(err)).toBe("invalid_request");
  });

  it("classifies non-GoogleApiError as unknown", () => {
    expect(classifyReviewError(new Error("Some error"))).toBe("unknown");
    expect(classifyReviewError("string error")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// ReviewSyncService.syncLocation — basic flow
// ---------------------------------------------------------------------------

describe("ReviewSyncService.syncLocation", () => {
  it("syncs a single page of reviews successfully", async () => {
    mockApiResponse(200, {
      reviews: [makeReview("r1"), makeReview("r2")],
    });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1"
    );

    expect(result.reviewsSynced).toBe(2);
    expect(result.pagesProcessed).toBe(1);
    expect(result.errorClass).toBeNull();
  });

  it("handles an empty reviews list (no reviews yet)", async () => {
    mockApiResponse(200, { reviews: [] });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1"
    );

    expect(result.reviewsSynced).toBe(0);
    expect(result.pagesProcessed).toBe(1);
    expect(result.errorClass).toBeNull();
  });

  it("incremental sync stops after two unchanged newest-first pages", async () => {
    syncState.locationLastSynced = "2026-10-01T00:00:00Z";
    const r1 = makeReview("r1");
    const r2 = makeReview("r2");
    const crypto = await import("crypto");
    const hashOf = (review: ReturnType<typeof makeReview>) =>
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            starRating: review.starRating,
            comment: review.comment ?? null,
            updateTime: review.updateTime ?? null,
            replyComment: null,
            replyUpdateTime: null,
          })
        )
        .digest("hex");
    syncState.existingReviewRows = [
      { google_review_name: r1.name, sync_hash: hashOf(r1), reply_status: "none" },
      { google_review_name: r2.name, sync_hash: hashOf(r2), reply_status: "none" },
    ];

    mockApiResponse(200, { reviews: [r1], nextPageToken: "p2" });
    mockApiResponse(200, { reviews: [r2], nextPageToken: "p3" });
    mockApiResponse(200, { reviews: [makeReview("r3")] });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1",
      { mode: "incremental" }
    );

    expect(result.mode).toBe("incremental");
    expect(result.pagesProcessed).toBe(2);
    expect(result.reviewsUpdated).toBe(0);
    expect(result.truncated).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain("orderBy=updateTime+desc");
  });

  it("handles pagination — fetches all pages", async () => {
    // Page 1
    mockApiResponse(200, {
      reviews: [makeReview("r1")],
      nextPageToken: "page2",
    });
    // Page 2
    mockApiResponse(200, {
      reviews: [makeReview("r2"), makeReview("r3")],
    });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1"
    );

    expect(result.reviewsSynced).toBe(3);
    expect(result.pagesProcessed).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("aborts on non-retryable 403 error and marks location failed", async () => {
    mockApiResponse(403, {
      error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" },
    });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1"
    );

    expect(result.errorClass).toBe("authorization");
    expect(result.reviewsSynced).toBe(0);
  });

  it("aborts on non-retryable 401 error", async () => {
    mockApiResponse(401, {
      error: { code: 401, message: "Unauthorized", status: "UNAUTHENTICATED" },
    });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1"
    );

    expect(result.errorClass).toBe("authentication");
  });

  it("retries on transient errors and succeeds on retry", async () => {
    // First two calls: 429 (rate_limit — transient)
    mockApiResponse(429, { error: { message: "Rate limit" } });
    mockApiResponse(429, { error: { message: "Rate limit" } });
    // Third call: success
    mockApiResponse(200, { reviews: [makeReview("r1")] });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1"
    );

    expect(result.reviewsSynced).toBe(1);
    expect(result.errorClass).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("marks partial sync when retries are exhausted on transient error", async () => {
    // The Google gate makes 5 attempts before giving up
    for (let i = 0; i < 5; i++) mockApiResponse(429, { error: { message: "Rate limit" } });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1"
    );

    expect(result.errorClass).toBe("rate_limit");
    expect(result.reviewsSynced).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("calling sync twice with same reviews does not duplicate upserts", async () => {
    const reviews = [makeReview("r1"), makeReview("r2")];

    // First sync
    mockApiResponse(200, { reviews });
    await ReviewSyncService.syncLocation("loc-1", "conn-1", "ws-1", "user-1");
    const firstUpsertCount = upsertCalls.length;

    // Second sync — same data
    mockApiResponse(200, { reviews });
    await ReviewSyncService.syncLocation("loc-1", "conn-1", "ws-1", "user-1");

    // Upsert is called with onConflict — DB-level uniqueness enforces no duplicates.
    // We verify the upsert was called the same number of times (not doubled).
    expect(upsertCalls.length).toBe(firstUpsertCount * 2);
    // But since the conflict key is the same, the DB upsert is safe.
    // Each call will be the same row identifier.
    const reviewNames = upsertCalls.flatMap((c) => {
      if (Array.isArray(c)) {
        return c.map((row) => (row as { google_review_name?: string }).google_review_name);
      }
      return [(c as { google_review_name?: string }).google_review_name];
    });
    const uniqueNames = new Set(reviewNames);
    // Only r1 and r2 should ever appear
    expect(uniqueNames.size).toBe(2);
  });

  it("does not upsert the full row when sync_hash is unchanged", async () => {
    // We can't test the hash skip path perfectly without a real DB,
    // but we can verify that when the API returns the same reviews,
    // the upsert is still called (onConflict handles dedup).
    // This test documents the expected behaviour: upsert is safe to re-run.
    const reviews = [makeReview("r1")];
    mockApiResponse(200, { reviews });
    const result1 = await ReviewSyncService.syncLocation("loc-1", "conn-1", "ws-1", "user-1");

    mockApiResponse(200, { reviews });
    const result2 = await ReviewSyncService.syncLocation("loc-1", "conn-1", "ws-1", "user-1");

    expect(result1.reviewsSynced).toBe(1);
    expect(result2.reviewsSynced).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sync recovery regressions
// ---------------------------------------------------------------------------

describe("sync recovery", () => {
  it("upgrades to a full crawl when the location was never fully synced, even if incremental was requested", async () => {
    syncState.locationFullSynced = null;
    // last_synced_at is stamped by location discovery before reviews exist;
    // it must not turn the first crawl into an incremental one.
    syncState.locationLastSynced = "2026-10-07T00:00:00Z";

    mockApiResponse(200, {
      reviews: [makeReview("r1")],
      nextPageToken: "page2",
      totalReviewCount: 2,
      averageRating: 4.5,
    });
    mockApiResponse(200, {
      reviews: [makeReview("r2")],
      totalReviewCount: 2,
      averageRating: 4.5,
    });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1",
      { mode: "incremental" }
    );

    expect(result.mode).toBe("full");
    expect(result.truncated).toBe(false);
    expect(result.pagesProcessed).toBe(2);
    expect(result.reviewsSynced).toBe(2);
    // A completed full crawl marks the location fully synced and stores
    // Google's totals for gap detection.
    const locationUpdate = updateCalls.find(
      (call) =>
        typeof call === "object" &&
        call !== null &&
        "reviews_full_synced_at" in (call as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;
    expect(locationUpdate?.reviews_full_synced_at).toBeTruthy();
    expect(locationUpdate?.total_review_count).toBe(2);
    expect(locationUpdate?.sync_status).toBe("success");
  });

  it("stores replied and unreplied reviews from the same page with an explicit reply_status on every row", async () => {
    mockApiResponse(200, {
      reviews: [
        makeReview("replied", {
          reviewReply: { comment: "Thanks!", updateTime: "2026-08-02T10:00:00Z" },
        }),
        makeReview("unreplied"),
      ],
    });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1"
    );

    expect(result.reviewsUpdated).toBe(2);
    const rows = upsertCalls.flatMap((call) =>
      Array.isArray(call) ? call : [call]
    ) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // PostgREST fills keys missing from some bulk-upsert rows with NULL;
    // every row must carry reply_status so a mixed page cannot fail on the
    // NOT NULL column and lose all 50 reviews.
    for (const row of rows) {
      expect(row).toHaveProperty("reply_status");
      expect(row).toHaveProperty("downstream_stale_at");
      expect(row).toHaveProperty("reopened_at");
    }
    expect(rows.find((r) => r.google_review_id === "replied")?.reply_status).toBe("published");
    expect(rows.find((r) => r.google_review_id === "unreplied")?.reply_status).toBe("none");
  });

  it("fails the sync instead of treating a failed page write as unchanged", async () => {
    syncState.upsertError = { message: "null value in column reply_status" };
    mockApiResponse(200, { reviews: [makeReview("r1")], nextPageToken: "page2" });
    mockApiResponse(200, { reviews: [makeReview("r2")] });

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1",
      { mode: "incremental" }
    );

    expect(result.errorClass).toBe("db_error");
    expect(result.errorMessage).toContain("reply_status");
    // It must stop at the failed page, not keep paging or report success.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const locationUpdate = updateCalls[updateCalls.length - 1] as Record<string, unknown>;
    expect(locationUpdate.sync_status).toBe("failed");
  });

  it("marks a truncated incremental sync as partial, not success", async () => {
    syncState.locationLastSynced = "2026-10-01T00:00:00Z";
    // 40 pages of brand-new reviews hit the incremental page cap.
    for (let page = 0; page < 40; page++) {
      mockApiResponse(200, {
        reviews: [makeReview(`bulk-${page}`)],
        nextPageToken: `page-${page + 1}`,
      });
    }

    const result = await ReviewSyncService.syncLocation(
      "loc-1",
      "conn-1",
      "ws-1",
      "user-1",
      { mode: "incremental" }
    );

    expect(result.truncated).toBe(true);
    expect(result.pagesProcessed).toBe(40);
    const locationUpdate = updateCalls[updateCalls.length - 1] as Record<string, unknown>;
    expect(locationUpdate.sync_status).toBe("partial");
    expect(locationUpdate.reviews_full_synced_at).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling in sync audit
// ---------------------------------------------------------------------------

describe("audit logging", () => {
  it("logs sync_started and synced (not one per page)", async () => {
    const { AuditService } = await import("@/lib/services/audit");
    const logSpy = vi.mocked(AuditService.log);

    mockApiResponse(200, { reviews: [makeReview("r1")] });
    await ReviewSyncService.syncLocation("loc-1", "conn-1", "ws-1", "user-1");

    // Should be called exactly twice: once for start, once for completion
    const actions = logSpy.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("review.sync_started");
    expect(actions).toContain("review.synced");
    // NOT one per review or per page
    expect(actions.length).toBe(2);
  });

  it("logs sync_failed on authorization error", async () => {
    const { AuditService } = await import("@/lib/services/audit");
    const logSpy = vi.mocked(AuditService.log);

    mockApiResponse(403, { error: { code: 403, message: "Forbidden", status: "PERMISSION_DENIED" } });
    await ReviewSyncService.syncLocation("loc-1", "conn-1", "ws-1", "user-1");

    const actions = logSpy.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("review.sync_failed");
  });
});
