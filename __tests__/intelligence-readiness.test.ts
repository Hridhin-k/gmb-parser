import { describe, expect, it } from "vitest";
import { parseDateRange } from "@/lib/date-range";
import { average } from "@/lib/metrics";
import { planBackfill } from "@/lib/intelligence/backfill-plan";
import { buildClusters, clusterQuality, CLUSTER_THRESHOLDS } from "@/lib/intelligence/cluster";
import { commitIsCurrent, freshnessLabel, planInvalidation } from "@/lib/intelligence/freshness";
import { enqueueClassifyJob, claimJob, failJob, jobKey } from "@/lib/intelligence/job-machine";
import { planReviewVersion } from "@/lib/intelligence/ingestion-plan";
import { applyModelProse, claimsMatch, discoverFindings, planInsightWrite, type InsightReview } from "@/lib/intelligence/insight";
import { buildSummaryDocument, type SummaryReview } from "@/lib/intelligence/summary-aggregate";
import { summaryWindow } from "@/lib/intelligence/summary-window";
import { overviewQueryKey } from "@/lib/overview-board";
import { checkRateLimit, WORKSPACE_AI_LIMIT } from "@/lib/rate-limit";
import { findingsForScope } from "@/lib/insight-page";
import { retrieveKnowledge, splitGeneration, type ReportProvenance } from "@/lib/intelligence/tenant-context";
import type { AiKnowledgeRow } from "@/lib/ai-config";

const workspaceA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const workspaceB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const client = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const locationA = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const locationB = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function summaryReview(partial: Partial<SummaryReview> & Pick<SummaryReview, "id" | "stars" | "createdAt">): SummaryReview {
  return {
    locationId: locationA,
    contentHash: partial.id,
    overall: "negative",
    topics: [],
    issues: [],
    praise: [],
    excerpts: [],
    ...partial,
  };
}

function insightReview(partial: Partial<InsightReview> & Pick<InsightReview, "id" | "locationId">): InsightReview {
  return {
    workspaceId: workspaceA,
    createdAt: "2026-08-10T00:00:00.000Z",
    stars: 2,
    overall: "negative",
    issues: [],
    praise: [],
    excerpts: [],
    clusterIds: [],
    severe: false,
    ...partial,
  };
}

describe("readiness: counts and versions", () => {
  it("dedupes a repeated review, weights the organisation average, and keeps windows apart", () => {
    const window = summaryWindow(parseDateRange({ range: "custom", from: "2026-08-01", to: "2026-08-31" }, "all"), "UTC");
    const loud = summaryReview({
      id: "r1",
      stars: 5,
      createdAt: "2026-08-02T00:00:00.000Z",
      locationId: locationA,
      topics: ["cleanliness", "queue_time"],
      issues: ["cleanliness"],
    });
    const many = Array.from({ length: 100 }, (_, index) =>
      summaryReview({
        id: `b${index}`,
        stars: 2,
        createdAt: "2026-08-03T00:00:00.000Z",
        locationId: locationB,
      })
    );
    const outside = summaryReview({
      id: "old",
      stars: 1,
      createdAt: "2025-01-01T00:00:00.000Z",
      locationId: locationA,
    });
    const document = buildSummaryDocument({
      scopeType: "organisation",
      scopeId: client,
      locationIds: [locationA, locationB],
      window,
      reviews: [loud, { ...loud, stars: 1 }, ...many, outside],
    });
    expect(document.coverage.reviewCount).toBe(101);
    expect(document.metrics.averageRating).toBeCloseTo(205 / 101, 4);
    expect(document.metrics.averageRating).not.toBeCloseTo(3.5, 1);
    const topic = document.topics.find((row) => row.code === "cleanliness");
    expect(topic?.reviews).toBe(1);
    expect(topic?.share).toBeCloseTo(1 / 101, 4);
    expect(document.locations.find((row) => row.locationId === locationB)?.reviewCount).toBe(100);
    const version = planReviewVersion(
      {
        id: "r1",
        comment: "dirty floor",
        starRating: 5,
        createTime: "2026-08-02T00:00:00.000Z",
        replyComment: null,
        contentFingerprint: null,
        responseFingerprint: null,
        missingOnGoogleAt: null,
      },
      { comment: "dirty floor", starRating: 5, createTime: "2026-08-02T00:00:00.000Z", replyComment: null }
    );
    const again = planReviewVersion(
      {
        id: "r1",
        comment: "dirty floor",
        starRating: 5,
        createTime: "2026-08-02T00:00:00.000Z",
        replyComment: null,
        contentFingerprint: version.contentFingerprint,
        responseFingerprint: version.responseFingerprint,
        missingOnGoogleAt: null,
      },
      { comment: "dirty floor", starRating: 5, createTime: "2026-08-02T00:00:00.000Z", replyComment: null }
    );
    expect(again.contentChanged).toBe(false);
    expect(again.created).toBe(false);
  });

  it("drops a deleted review from the aggregate when the caller omits it and stales the summary", () => {
    const window = summaryWindow(parseDateRange({ range: "all" }, "all"), "UTC");
    const kept = buildSummaryDocument({
      scopeType: "location",
      scopeId: locationA,
      locationIds: [locationA],
      window,
      reviews: [summaryReview({ id: "kept", stars: 4, createdAt: "2026-08-02T00:00:00.000Z", overall: "positive" })],
    });
    expect(kept.coverage.reviewCount).toBe(1);
    const plan = planInvalidation({ kind: "review_deleted", reviewId: "gone", locationId: locationA });
    expect(plan.stale).toContain("summary");
    expect(plan.jobs.some((item) => item.operation === "build_summary")).toBe(true);
  });
});

describe("readiness: tenant boundaries", () => {
  it("refuses another workspace's knowledge, evidence, and jobs", () => {
    const foreign: AiKnowledgeRow = {
      id: "foreign",
      workspaceId: workspaceB,
      clientId: null,
      groupId: null,
      locationId: null,
      kind: "instruction",
      title: "Secret",
      body: "Tenant B only",
      enabled: true,
      metadata: {},
    };
    const own: AiKnowledgeRow = { ...foreign, id: "own", workspaceId: workspaceA, body: "Tenant A" };
    const selected = retrieveKnowledge([foreign, own], {
      workspaceId: workspaceA,
      clientId: null,
      groupId: null,
      parentGroupId: null,
      locationId: null,
    }, "");
    expect(selected.map((row) => row.body)).toEqual(["Tenant A"]);
    expect(findingsForScope([{ locationIds: [locationB] }, { locationIds: [locationA] }], [locationA])).toHaveLength(1);
    const queued = enqueueClassifyJob([], {
      id: "j1",
      workspaceId: workspaceA,
      reviewId: "r1",
      locationId: locationA,
      sourceHash: "h1",
      now: "2026-10-20T00:00:00.000Z",
    });
    const other = enqueueClassifyJob(queued.jobs, {
      id: "j2",
      workspaceId: workspaceB,
      reviewId: "r1",
      locationId: locationA,
      sourceHash: "h1",
      now: "2026-10-20T00:00:00.000Z",
    });
    expect(other.created).toBe(true);
    expect(jobKey(queued.job)).not.toBe(jobKey(other.job));
    const operation = `readiness.ai.${workspaceA}`;
    const limitA = checkRateLimit(`workspace:${workspaceA}`, operation, { ...WORKSPACE_AI_LIMIT, limit: 1 });
    const limitB = checkRateLimit(`workspace:${workspaceB}`, operation, { ...WORKSPACE_AI_LIMIT, limit: 1 });
    expect(limitA.allowed).toBe(true);
    expect(limitB.allowed).toBe(true);
    expect(checkRateLimit(`workspace:${workspaceA}`, operation, { ...WORKSPACE_AI_LIMIT, limit: 1 }).allowed).toBe(false);
  });

  it("uses the same URL key for two workspaces when the query string matches", () => {
    const read = (key: string) => (key === "client" ? client : "");
    expect(overviewQueryKey(read)).toBe(overviewQueryKey(read));
    expect(overviewQueryKey(read).includes(workspaceA)).toBe(false);
  });
});

describe("readiness: finding quality", () => {
  it("does not treat two reviews as a supported finding and rejects a foreign review id", () => {
    const window = summaryWindow(parseDateRange({ range: "custom", from: "2026-08-01", to: "2026-08-31" }, "all"), "UTC");
    const reviews = [
      insightReview({ id: "a1", locationId: locationA, stars: 5, overall: "positive", issues: ["cleanliness"], excerpts: [{ topicCode: "cleanliness", polarity: "complaint", text: "dirty floor" }] }),
      insightReview({ id: "a2", locationId: locationB, stars: 5, overall: "positive" }),
    ];
    const summary = buildSummaryDocument({
      scopeType: "organisation",
      scopeId: client,
      locationIds: [locationA, locationB],
      window,
      reviews: reviews.map((item) => ({
        id: item.id,
        locationId: item.locationId,
        createdAt: item.createdAt,
        stars: item.stars,
        contentHash: item.id,
        overall: item.overall,
        topics: item.issues,
        issues: item.issues,
        praise: [],
        excerpts: item.excerpts,
      })),
    });
    const draft = discoverFindings({
      workspaceId: workspaceA,
      clientId: client,
      scopeType: "organisation",
      scopeId: client,
      locationIds: [locationA, locationB],
      window,
      summary,
      reviews,
      previousReviews: [],
      clusters: [],
    });
    expect(draft.insufficient).toBe(true);
    expect(draft.findings).toHaveLength(0);
    const watched = clusterQuality(1, 0.9, "high", CLUSTER_THRESHOLDS);
    expect(watched).toBe("watch");
  });

  it("keeps deterministic wording when the model invents a number", () => {
    const window = summaryWindow(parseDateRange({ range: "custom", from: "2026-08-01", to: "2026-08-31" }, "all"), "UTC");
    const reviews = [1, 2, 3].map((index) =>
      insightReview({
        id: `b${index}`,
        locationId: index === 3 ? locationB : locationA,
        issues: index < 3 ? ["billing_delay"] : [],
        excerpts: index < 3 ? [{ topicCode: "billing_delay", polarity: "complaint", text: "billing queue" }] : [],
      })
    );
    reviews.push(
      insightReview({ id: "b4", locationId: locationB, issues: [] }),
      insightReview({ id: "b5", locationId: locationB, issues: [] }),
      insightReview({ id: "b6", locationId: locationA, issues: ["billing_delay"], excerpts: [{ topicCode: "billing_delay", polarity: "complaint", text: "slow billing" }] })
    );
    const summary = buildSummaryDocument({
      scopeType: "organisation",
      scopeId: client,
      locationIds: [locationA, locationB],
      window,
      reviews: reviews.map((item) => ({
        id: item.id,
        locationId: item.locationId,
        createdAt: item.createdAt,
        stars: item.stars,
        contentHash: item.id,
        overall: item.overall,
        topics: item.issues,
        issues: item.issues,
        praise: [],
        excerpts: item.excerpts,
      })),
    });
    const draft = discoverFindings({
      workspaceId: workspaceA,
      clientId: client,
      scopeType: "organisation",
      scopeId: client,
      locationIds: [locationA, locationB],
      window,
      summary,
      reviews: [...reviews, insightReview({ id: "nope", locationId: locationA, workspaceId: workspaceB })],
      previousReviews: [],
      clusters: [],
    });
    const finding = draft.findings.find((item) => item.category === "anomaly");
    expect(finding).toBeTruthy();
    if (!finding) return;
    expect(finding.reviewIds).not.toContain("nope");
    expect(claimsMatch(finding, {
      workspaceId: workspaceA,
      clientId: client,
      scopeType: "organisation",
      scopeId: client,
      locationIds: [locationA, locationB],
      window,
      summary,
      reviews,
      previousReviews: [],
      clusters: [],
    })).toBe(true);
    const rewritten = applyModelProse(finding, { explanation: "This affected 99 reviews." }, "gemini-3.5-flash-lite");
    expect(rewritten.explanation).toBe(finding.explanation);
    expect(rewritten.model).toBe("none");
  });
});

describe("readiness: freshness and backfill", () => {
  it("does not let an older job or an open duplicate replace the current result", () => {
    expect(commitIsCurrent({ sourceHash: "old", analysisVersion: "extract-v1" }, { sourceHash: "new", analysisVersion: "extract-v1" })).toBe(false);
    const first = enqueueClassifyJob([], {
      id: "j1",
      workspaceId: workspaceA,
      reviewId: "r1",
      locationId: locationA,
      sourceHash: "h1",
      now: "2026-10-20T00:00:00.000Z",
    });
    const second = enqueueClassifyJob(first.jobs, {
      id: "j2",
      workspaceId: workspaceA,
      reviewId: "r1",
      locationId: locationA,
      sourceHash: "h1",
      now: "2026-10-20T00:01:00.000Z",
    });
    expect(second.created).toBe(false);
    const claimed = claimJob(first.jobs, "j1", "2026-10-20T00:02:00.000Z");
    expect(claimJob(claimed.jobs, "j1", "2026-10-20T00:03:00.000Z").claimed).toBeNull();
    const failed = failJob(claimed.jobs, "j1", { errorClass: "unavailable", message: "provider down", now: "2026-10-20T00:04:00.000Z" });
    expect(failed.job?.status).toBe("queued");
    const open = planInsightWrite([], "hash", false, true);
    expect(open.action).toBe("processing");
    const stored: ReportProvenance = { id: "report-1", configVersion: 1, rulesHash: "aaa", reviewCount: 10 };
    const next = splitGeneration([stored], { configVersion: 2, rulesHash: "bbb" });
    expect(stored.reviewCount).toBe(10);
    expect(next.metricsRewritten).toBe(false);
    expect(freshnessLabel({
      summaryStatus: "ready",
      reportStatus: "stale",
      reportMatchesSummary: false,
      openJob: "running",
      insufficient: false,
      metricsMatch: true,
      clustersCurrent: true,
      hasCompletedReport: true,
    }).showPrevious).toBe(true);
    const plan = planBackfill(
      [
        { id: "r1", workspaceId: workspaceA, hasText: true, contentHash: "h1" },
        { id: "r1", workspaceId: workspaceA, hasText: true, contentHash: "h1" },
        { id: "r2", workspaceId: workspaceA, hasText: true, contentHash: "h2" },
        { id: "r3", workspaceId: workspaceB, hasText: false, contentHash: "h3" },
      ],
      {
        intelligence: [{ reviewId: "r2", workspaceId: workspaceA, contentHash: "h2" }],
        embeddings: [{ reviewId: "r2", workspaceId: workspaceA, contentHash: "h2" }],
      },
      1
    );
    expect(plan.start).toBe(false);
    expect(plan.skippedCurrent).toBe(1);
    expect(plan.extractCalls).toBe(1);
    expect(plan.batches.map((batch) => batch.workspaceId)).toEqual([workspaceA, workspaceB]);
    expect(new Set(plan.batches.map((batch) => batch.workspaceId)).size).toBe(2);
  });

  it("builds a 1,000-review summary in well under a second on this machine", () => {
    const window = summaryWindow(parseDateRange({ range: "all" }, "all"), "UTC");
    const reviews = Array.from({ length: 1000 }, (_, index) =>
      summaryReview({
        id: `n${index}`,
        stars: (index % 5) + 1,
        createdAt: "2026-08-02T00:00:00.000Z",
        locationId: index % 2 === 0 ? locationA : locationB,
        topics: ["cleanliness"],
        issues: index % 4 === 0 ? ["cleanliness"] : [],
      })
    );
    const started = performance.now();
    const document = buildSummaryDocument({
      scopeType: "organisation",
      scopeId: client,
      locationIds: [locationA, locationB],
      window,
      reviews,
    });
    const elapsed = performance.now() - started;
    expect(document.coverage.reviewCount).toBe(1000);
    expect(document.metrics.averageRating).toBeCloseTo(average(reviews.reduce((sum, review) => sum + review.stars, 0), 1000) ?? 0, 4);
    expect(elapsed).toBeLessThan(1000);
    console.info(`readiness.summary_1000_ms ${elapsed.toFixed(1)}`);
  });
});

describe("readiness: clusters stay explainable", () => {
  it("does not merge different topic sets", () => {
    const result = buildClusters({
      points: [
        { reviewId: "a", workspaceId: workspaceA, locationId: locationA, topics: ["cleanliness"], vector: [1, 0], severity: "low", createdAt: "2026-08-01T00:00:00.000Z", excerpt: "dirty floor" },
        { reviewId: "b", workspaceId: workspaceA, locationId: locationA, topics: ["billing_delay"], vector: [1, 0], severity: "low", createdAt: "2026-08-02T00:00:00.000Z", excerpt: "billing queue" },
      ],
      thresholds: CLUSTER_THRESHOLDS,
    });
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.every((cluster) => cluster.members.length === 1)).toBe(true);
  });
});
