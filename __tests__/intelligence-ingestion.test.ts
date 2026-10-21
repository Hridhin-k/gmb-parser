import { describe, expect, it } from "vitest";
import { contentFingerprint, responseFingerprint, canonicalStars } from "@/lib/intelligence/fingerprint";
import { absenceIsConfirmed, planReviewVersion, reviewsConfirmedMissing } from "@/lib/intelligence/ingestion-plan";
import {
  claimJob,
  enqueueClassifyJob,
  failJob,
  publicProcessingStatus,
  recoverAbandonedJobs,
  type IntelligenceJob,
} from "@/lib/intelligence/job-machine";
import { executeClassifyJob } from "@/lib/intelligence/classify-job";
import { buildRatingOnlyExtraction } from "@/lib/intelligence/extraction";
import { buildRulesIntelligence } from "@/lib/intelligence/rules-intelligence";
import { reconcileSnapshot, resetReconcileIds, type ReconcileSnapshot } from "@/lib/intelligence/reconcile";

const NOW = "2026-10-20T10:00:00.000Z";

function reviewVersion(overrides: Partial<Parameters<typeof planReviewVersion>[1]> = {}) {
  return {
    starRating: 5,
    comment: "Great place",
    createTime: "2026-08-01T10:00:00Z",
    replyComment: null,
    ...overrides,
  };
}

describe("content fingerprint", () => {
  it("ignores reviewer metadata and Google update timestamps", () => {
    const first = contentFingerprint({
      starRating: "FIVE",
      comment: "Great place",
      createTime: "2026-08-01T10:00:00Z",
    });
    const second = contentFingerprint({
      starRating: 5,
      comment: "Great place\r\n",
      createTime: "2026-08-01T10:00:00.000Z",
    });
    expect(second).toBe(first);
    expect(canonicalStars("TWO")).toBe(2);
    expect(contentFingerprint({ starRating: 5, comment: "e\u0301", createTime: NOW })).toBe(
      contentFingerprint({ starRating: 5, comment: "\u00e9", createTime: NOW })
    );
  });

  it("changes when text, stars, review date, or the Google reply changes", () => {
    const base = contentFingerprint(reviewVersion());
    expect(contentFingerprint(reviewVersion({ comment: "Slow queue" }))).not.toBe(base);
    expect(contentFingerprint(reviewVersion({ starRating: 2 }))).not.toBe(base);
    expect(contentFingerprint(reviewVersion({ createTime: "2026-09-01T10:00:00Z" }))).not.toBe(base);
    const reply = responseFingerprint("Thanks");
    expect(responseFingerprint(null)).not.toBe(reply);
    expect(responseFingerprint("Thanks")).toBe(reply);
    expect(contentFingerprint(reviewVersion())).toBe(base);
  });
});

describe("ingestion plan", () => {
  it("schedules a new review and skips a duplicate of the same version", () => {
    const created = planReviewVersion(null, reviewVersion());
    expect(created.contentChanged).toBe(true);
    const again = planReviewVersion(
      {
        id: "rev-1",
        comment: "Great place",
        starRating: 5,
        createTime: "2026-08-01T10:00:00.000Z",
        replyComment: null,
        contentFingerprint: created.contentFingerprint,
        responseFingerprint: created.responseFingerprint,
        missingOnGoogleAt: null,
      },
      reviewVersion()
    );
    expect(again.contentChanged).toBe(false);
    expect(again.responseChanged).toBe(false);
  });

  it("reprocesses a text change and only invalidates summaries for a reply change", () => {
    const priorPrint = planReviewVersion(null, reviewVersion());
    const prior = {
      id: "rev-1",
      comment: "Great place",
      starRating: 5,
      createTime: "2026-08-01T10:00:00Z",
      replyComment: null as string | null,
      contentFingerprint: priorPrint.contentFingerprint,
      responseFingerprint: priorPrint.responseFingerprint,
      missingOnGoogleAt: null,
    };
    const edited = planReviewVersion(prior, reviewVersion({ comment: "The staff were rude" }));
    expect(edited.contentChanged).toBe(true);
    const replied = planReviewVersion(prior, reviewVersion({ replyComment: "Sorry about that" }));
    expect(replied.contentChanged).toBe(false);
    expect(replied.responseChanged).toBe(true);
  });

  it("confirms absence only after a complete full sync", () => {
    expect(absenceIsConfirmed({ mode: "full", providerFailed: false, truncated: false })).toBe(true);
    expect(absenceIsConfirmed({ mode: "incremental", providerFailed: false, truncated: false })).toBe(false);
    expect(absenceIsConfirmed({ mode: "full", providerFailed: true, truncated: false })).toBe(false);
    expect(absenceIsConfirmed({ mode: "full", providerFailed: false, truncated: true })).toBe(false);
    const local = [
      { id: "keep", googleReviewName: "accounts/a/reviews/1", missingOnGoogleAt: null },
      { id: "gone", googleReviewName: "accounts/a/reviews/2", missingOnGoogleAt: null },
      { id: "already", googleReviewName: "accounts/a/reviews/3", missingOnGoogleAt: NOW },
    ];
    const missing = reviewsConfirmedMissing(local, new Set(["accounts/a/reviews/1"]));
    expect(missing.map((row) => row.id)).toEqual(["gone"]);
  });

  it("requeues a review that returns after a confirmed absence", () => {
    const first = planReviewVersion(null, reviewVersion());
    const back = planReviewVersion(
      {
        id: "rev-1",
        comment: "Great place",
        starRating: 5,
        createTime: "2026-08-01T10:00:00Z",
        replyComment: null,
        contentFingerprint: first.contentFingerprint,
        responseFingerprint: first.responseFingerprint,
        missingOnGoogleAt: NOW,
      },
      reviewVersion()
    );
    expect(back.contentChanged).toBe(true);
  });
});

describe("processing jobs", () => {
  function seed(overrides: Partial<IntelligenceJob> = {}): IntelligenceJob {
    return {
      id: "job-1",
      workspaceId: "ws-1",
      operation: "classify_review",
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      errorClass: null,
      lastError: null,
      reviewId: "rev-1",
      locationId: "loc-1",
      sourceHash: "hash-1",
      analysisVersion: "extract-v2",
      notBefore: null,
      startedAt: null,
      finishedAt: null,
      createdAt: NOW,
      ...overrides,
    };
  }

  it("is idempotent and lets only one worker claim a job", () => {
    const first = enqueueClassifyJob([], {
      id: "job-1",
      workspaceId: "ws-1",
      reviewId: "rev-1",
      locationId: "loc-1",
      sourceHash: "hash-1",
      now: NOW,
    });
    const second = enqueueClassifyJob(first.jobs, {
      id: "job-2",
      workspaceId: "ws-1",
      reviewId: "rev-1",
      locationId: "loc-1",
      sourceHash: "hash-1",
      now: NOW,
    });
    expect(second.created).toBe(false);
    expect(second.jobs).toHaveLength(1);
    const claimed = claimJob(second.jobs, "job-1", NOW);
    const loser = claimJob(claimed.jobs, "job-1", NOW);
    expect(claimed.claimed?.status).toBe("running");
    expect(loser.claimed).toBeNull();
  });

  it("schedules a retry and then dead-letters the job", () => {
    let jobs = [seed()];
    const first = failJob(jobs, "job-1", { errorClass: "timeout", message: "timeout", now: NOW });
    jobs = first.jobs;
    expect(publicProcessingStatus(first.job!, NOW)).toBe("retry_scheduled");
    expect(first.job?.status).toBe("queued");
    expect(first.job?.errorClass).toBe("timeout");
    const later = new Date(Date.parse(first.job!.notBefore!) + 1000).toISOString();
    const second = failJob(jobs, "job-1", { errorClass: "unknown", message: "again", now: later });
    const third = failJob(second.jobs, "job-1", { errorClass: "unknown", message: "again", now: later });
    expect(third.job?.status).toBe("failed");
    expect(publicProcessingStatus(third.job!, later)).toBe("failed");
  });

  it("returns an interrupted job to the queue", () => {
    const running = seed({ status: "running", startedAt: "2026-10-20T09:00:00.000Z" });
    const recovered = recoverAbandonedJobs([running], NOW);
    expect(recovered.recovered).toBe(1);
    expect(recovered.jobs[0]?.status).toBe("queued");
    expect(publicProcessingStatus(recovered.jobs[0]!, NOW)).toBe("retry_scheduled");
  });

  it("does not mark a job completed when the write fails", async () => {
    const job = seed();
    let stored = job;
    const committed = false;
    const status = await executeClassifyJob(job.id, {
      now: () => NOW,
      claim: async () => {
        const claimed = claimJob([stored], job.id, NOW);
        stored = claimed.claimed ?? stored;
        return claimed.claimed;
      },
      saveJob: async (next) => {
        stored = next;
      },
      loadReview: async () => ({
        id: "rev-1",
        workspaceId: "ws-1",
        locationId: "loc-1",
        contentFingerprint: "hash-1",
        starRating: 2,
        comment: "The staff were rude",
        missingOnGoogleAt: null,
      }),
      extract: async () => buildRatingOnlyExtraction(2),
      commitIntelligence: async () => {
        throw new Error("database unavailable");
      },
    });
    expect(committed).toBe(false);
    expect(status).toBe("retry_scheduled");
    expect(stored.status).not.toBe("succeeded");
  });

  it("commits intelligence before acknowledging success", async () => {
    const job = seed({ sourceHash: contentFingerprint({ starRating: 2, comment: "The staff were rude", createTime: NOW }) });
    const order: string[] = [];
    let stored = job;
    const fingerprint = job.sourceHash;
    const status = await executeClassifyJob(job.id, {
      now: () => NOW,
      claim: async () => {
        const claimed = claimJob([stored], job.id, NOW);
        if (claimed.claimed) {
          stored = claimed.claimed;
          order.push("claim");
        }
        return claimed.claimed;
      },
      saveJob: async (next) => {
        order.push(next.status);
        stored = next;
      },
      loadReview: async () => ({
        id: "rev-1",
        workspaceId: "ws-1",
        locationId: "loc-1",
        contentFingerprint: fingerprint,
        starRating: 2,
        comment: "The staff were rude",
        missingOnGoogleAt: null,
      }),
      extract: async () => {
        order.push("extract");
        return buildRatingOnlyExtraction(2);
      },
      commitIntelligence: async () => {
        order.push("commit");
      },
    });
    expect(status).toBe("completed");
    expect(order).toEqual(["claim", "extract", "commit", "succeeded"]);
    expect(buildRulesIntelligence({ starRating: 2, comment: "The staff were rude" }).issueCode).toBe("staff");
    expect(buildRulesIntelligence({ starRating: 5, comment: "Great" }).issueCode).toBeNull();
  });
});

describe("reconciliation", () => {
  function snapshot(overrides: Partial<ReconcileSnapshot> = {}): ReconcileSnapshot {
    return {
      workspaceId: "ws-1",
      now: NOW,
      reviews: [
        {
          id: "rev-1",
          locationId: "loc-1",
          contentFingerprint: "hash-new",
          missingOnGoogleAt: null,
          downstreamStaleAt: NOW,
        },
      ],
      intelligence: [],
      jobs: [],
      summaries: [
        {
          id: "sum-1",
          status: "ready",
          locationId: "loc-1",
          memberLocationIds: ["loc-1"],
          generatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      ...overrides,
    };
  }

  it("finds missing intelligence, obsolete versions, and stale summaries, then does nothing new", () => {
    resetReconcileIds();
    const first = reconcileSnapshot(
      snapshot({
        intelligence: [
          {
            id: "intel-old",
            reviewId: "rev-1",
            contentHash: "hash-old",
            analysisVersion: "extract-v2",
            isCurrent: true,
            status: "ready",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      })
    );
    expect(first.missingReviewIds).toEqual(["rev-1"]);
    expect(first.obsoleteReviewIds).toEqual(["rev-1"]);
    expect(first.staleIntelligenceIds).toEqual(["intel-old"]);
    expect(first.staleSummaryIds).toEqual(["sum-1"]);
    expect(first.enqueued).toHaveLength(1);

    const applied = snapshot({
      intelligence: [
        {
          id: "intel-old",
          reviewId: "rev-1",
          contentHash: "hash-old",
          analysisVersion: "extract-v2",
          isCurrent: false,
          status: "stale",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      jobs: first.jobs,
      summaries: [
        {
          id: "sum-1",
          status: "stale",
          locationId: "loc-1",
          memberLocationIds: ["loc-1"],
          generatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    const second = reconcileSnapshot(applied);
    expect(second.enqueued).toHaveLength(0);
    expect(second.staleSummaryIds).toHaveLength(0);
    expect(second.staleIntelligenceIds).toHaveLength(0);
  });

  it("does not queue a confirmed-missing review and reports failed jobs", () => {
    const failed: IntelligenceJob = {
      id: "job-failed",
      workspaceId: "ws-1",
      operation: "classify_review",
      status: "failed",
      attempts: 5,
      maxAttempts: 5,
      errorClass: "unknown",
      lastError: "gave up",
      reviewId: "rev-1",
      locationId: "loc-1",
      sourceHash: "hash-new",
      analysisVersion: "rules-v1",
      notBefore: null,
      startedAt: null,
      finishedAt: NOW,
      createdAt: NOW,
    };
    const result = reconcileSnapshot(
      snapshot({
        reviews: [
          {
            id: "rev-1",
            locationId: "loc-1",
            contentFingerprint: "hash-new",
            missingOnGoogleAt: NOW,
            downstreamStaleAt: NOW,
          },
        ],
        jobs: [failed],
      })
    );
    expect(result.enqueued).toHaveLength(0);
    expect(result.missingReviewIds).toHaveLength(0);
    expect(result.failedJobIds).toEqual(["job-failed"]);
    expect(result.staleSummaryIds).toEqual(["sum-1"]);
  });

  it("cancels a duplicate open job and keeps one", () => {
    const older = enqueueClassifyJob([], {
      id: "job-a",
      workspaceId: "ws-1",
      reviewId: "rev-1",
      locationId: "loc-1",
      sourceHash: "hash-new",
      now: "2026-10-20T09:00:00.000Z",
    });
    const duplicated = {
      ...older.job,
      id: "job-b",
      createdAt: NOW,
    };
    const result = reconcileSnapshot(snapshot({ jobs: [older.job, duplicated] }));
    expect(result.cancelledJobIds).toEqual(["job-b"]);
    expect(result.jobs.filter((job) => job.status === "queued")).toHaveLength(1);
  });
});
