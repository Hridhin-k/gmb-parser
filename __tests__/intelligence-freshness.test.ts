import { describe, expect, it } from "vitest";
import { planReviewVersion } from "@/lib/intelligence/ingestion-plan";
import {
  alignStoredIntelligence,
  commitIsCurrent,
  freshnessLabel,
  planInvalidation,
  reconcileFreshness,
  FRESHNESS_ENQUEUE_CAP,
} from "@/lib/intelligence/freshness";
import { TAXONOMY_VERSION } from "@/lib/intelligence/taxonomy";
import { INSIGHT_PROMPT_VERSION } from "@/lib/intelligence/insight";

const review = { reviewId: "r1", locationId: "loc-1", contentHash: "content-1" };

describe("freshness boundaries", () => {
  it("classifies and embeds a new review with text, and only the summaries for its location", () => {
    const plan = planInvalidation({ kind: "review_inserted", ...review, hasText: true });
    expect(plan.jobs.map((job) => job.operation)).toEqual(["classify_review", "embed_review", "build_summary"]);
    expect(plan.jobs.every((job) => job.reviewId === "r1" || job.locationId === "loc-1")).toBe(true);
    expect(plan.untouched).toContain("intelligence");
  });

  it("reclassifies and re-embeds when the text changes", () => {
    const plan = planInvalidation({ kind: "review_text_changed", ...review, textHash: "text-1" });
    expect(plan.jobs.map((job) => job.operation)).toEqual(["classify_review", "embed_review", "build_summary"]);
    expect(plan.stale).toContain("embedding");
    expect(plan.metricsStayValid).toBe(false);
  });

  it("refreshes metrics after a rating change and leaves embeddings alone", () => {
    const plan = planInvalidation({ kind: "review_rating_changed", ...review });
    expect(plan.jobs.map((job) => job.operation)).toEqual(["build_summary"]);
    expect(plan.untouched).toEqual(["intelligence", "embedding", "cluster"]);
    const version = planReviewVersion(
      {
        id: "r1",
        comment: "Slow queue",
        starRating: 5,
        createTime: "2026-08-01T00:00:00.000Z",
        replyComment: null,
        contentFingerprint: null,
        responseFingerprint: null,
        missingOnGoogleAt: null,
      },
      { comment: "Slow queue", starRating: 2, createTime: "2026-08-01T00:00:00.000Z", replyComment: null }
    );
    expect(version.ratingChanged).toBe(true);
    expect(version.textChanged).toBe(false);
    expect(version.contentChanged).toBe(true);
  });

  it("refreshes group reports after a membership change and does not reprocess reviews", () => {
    const plan = planInvalidation({ kind: "membership_changed", locationIds: ["loc-1", "loc-2"] });
    expect(plan.jobs.every((job) => job.operation === "build_summary")).toBe(true);
    expect(plan.untouched).toContain("embedding");
    expect(plan.stale).toContain("insight_report");
  });

  it("reclassifies for a taxonomy change, keeps embeddings, and caps the queue", () => {
    const reviewIds = Array.from({ length: 25 }, (_, index) => ({
      reviewId: `r${index}`,
      locationId: "loc-1",
      contentHash: `h${index}`,
    }));
    const plan = planInvalidation({ kind: "taxonomy_changed", taxonomyVersion: "taxonomy-v3", reviewIds });
    expect(plan.jobs.filter((job) => job.operation === "classify_review")).toHaveLength(FRESHNESS_ENQUEUE_CAP);
    expect(plan.jobs.some((job) => job.operation === "backfill")).toBe(true);
    expect(plan.jobs.some((job) => job.operation === "embed_review")).toBe(false);
    expect(plan.metricsStayValid).toBe(true);
    expect(plan.untouched).toContain("metric_snapshot");
  });

  it("re-embeds for a model change and does not invalidate rating metrics", () => {
    const plan = planInvalidation({
      kind: "embedding_model_changed",
      model: "gemini-embedding-001",
      reviewIds: [{ reviewId: "r1", locationId: "loc-1", textHash: "text-1" }],
    });
    expect(plan.jobs.map((job) => job.operation)).toEqual(["embed_review"]);
    expect(plan.untouched).toContain("metric_snapshot");
    expect(plan.metricsStayValid).toBe(true);
  });

  it("regenerates reports for a prompt or tenant rules change and leaves summaries in place", () => {
    const prompt = planInvalidation({ kind: "insight_prompt_changed", promptVersion: "insight-v2", summaryIds: ["s1"] });
    const rules = planInvalidation({ kind: "tenant_rules_changed", rulesHash: "rules-2", summaryIds: ["s1"] });
    expect(prompt.stale).toEqual(["insight_report"]);
    expect(rules.untouched).toContain("summary");
    expect(rules.untouched).toContain("metric_snapshot");
    expect(rules.jobs[0]?.operation).toBe("build_report");
  });

  it("refuses a commit from an older source hash", () => {
    expect(commitIsCurrent({ sourceHash: "old", analysisVersion: "extract-v1" }, { sourceHash: "new", analysisVersion: "extract-v1" })).toBe(false);
    expect(commitIsCurrent({ sourceHash: "same", analysisVersion: "embed-v1" }, { sourceHash: "same", analysisVersion: "embed-v1" })).toBe(true);
    const patched = alignStoredIntelligence({ facts: { rating: { stars: 5 } } }, 2) as { facts: { rating: { stars: number } } };
    expect(patched.facts.rating.stars).toBe(2);
  });
});

describe("freshness status and repair", () => {
  it("labels a matching report current and a refresh with a previous report as stale", () => {
    expect(freshnessLabel({
      summaryStatus: "ready",
      reportStatus: "ready",
      reportMatchesSummary: true,
      openJob: "none",
      insufficient: false,
      metricsMatch: true,
      clustersCurrent: true,
      hasCompletedReport: true,
    }).label).toBe("current");
    const pending = freshnessLabel({
      summaryStatus: "stale",
      reportStatus: "stale",
      reportMatchesSummary: false,
      openJob: "running",
      insufficient: false,
      metricsMatch: false,
      clustersCurrent: false,
      hasCompletedReport: true,
    });
    expect(pending.label).toBe("processing");
    expect(pending.showPrevious).toBe(true);
    expect(freshnessLabel({
      summaryStatus: "ready",
      reportStatus: "ready",
      reportMatchesSummary: true,
      openJob: "none",
      insufficient: true,
      metricsMatch: true,
      clustersCurrent: true,
      hasCompletedReport: true,
    }).label).toBe("insufficient_data");
    expect(freshnessLabel({
      summaryStatus: "failed",
      reportStatus: "missing",
      reportMatchesSummary: false,
      openJob: "none",
      insufficient: false,
      metricsMatch: false,
      clustersCurrent: false,
      hasCompletedReport: false,
    }).label).toBe("failed");
  });

  it("queues missing intelligence and is quiet on the repaired snapshot", () => {
    const base = {
      now: "2026-10-20T12:00:00.000Z",
      taxonomyVersion: TAXONOMY_VERSION,
      embeddingModel: "gemini-embedding-001",
      insightPrompt: INSIGHT_PROMPT_VERSION,
      reviews: [{ id: "r1", locationId: "loc-1", contentHash: "content-1", textHash: "text-1", missing: false }],
      intelligence: [],
      embeddings: [],
      summaries: [{ id: "s1", status: "ready", sourceHash: "sum-1", taxonomyVersion: TAXONOMY_VERSION }],
      snapshots: [{ id: "snap-1", summaryId: "s1", inputsHash: "old" }],
      reports: [{ id: "rep-1", summaryId: "s1", status: "ready", summarySourceHash: "other", promptVersion: INSIGHT_PROMPT_VERSION, evidenceReviewIds: ["gone"] }],
      jobs: [{ id: "job-1", status: "running", attempts: 4, maxAttempts: 5, startedAt: "2026-10-20T11:00:00.000Z" }],
    };
    const first = reconcileFreshness(base);
    expect(first.missingIntelligenceReviewIds).toEqual(["r1"]);
    expect(first.outdatedSnapshotIds).toEqual(["snap-1"]);
    expect(first.staleReportIds).toEqual(["rep-1"]);
    expect(first.abandonedRecovered).toBe(1);
    expect(first.failedJobIds).toContain("job-1");
    const repaired = reconcileFreshness({
      ...base,
      intelligence: [{ reviewId: "r1", contentHash: "content-1", taxonomyVersion: TAXONOMY_VERSION, status: "ready" }],
      embeddings: [{ reviewId: "r1", contentHash: "text-1", model: "gemini-embedding-001" }],
      snapshots: [{ id: "snap-1", summaryId: "s1", inputsHash: "sum-1" }],
      reports: [{ id: "rep-1", summaryId: "s1", status: "stale", summarySourceHash: "sum-1", promptVersion: INSIGHT_PROMPT_VERSION, evidenceReviewIds: ["r1"] }],
      jobs: [],
    });
    expect(repaired.jobs).toEqual([]);
    expect(repaired.staleReportIds).toEqual([]);
    expect(repaired.outdatedSnapshotIds).toEqual([]);
    expect(repaired.missingIntelligenceReviewIds).toEqual([]);
  });
});
