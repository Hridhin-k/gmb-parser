import { describe, expect, it } from "vitest";
import { CLUSTER_EVAL_REVIEWS, chooseJoinThreshold } from "@/lib/intelligence/cluster-eval";
import {
  buildClusters,
  clusterNavigation,
  clusterQuality,
  makeClusterKey,
  topicKey,
  withFittingCleanliness,
  type ClusterPoint,
  type PreviousCluster,
} from "@/lib/intelligence/cluster";
import { embeddingContentHash, embeddingInput, planEmbeddingWork, requestEmbedding } from "@/lib/intelligence/embed";
import { cosine, fitEmbedding, l2normalize } from "@/lib/intelligence/vectors";

const thresholds = { join: 0.75, overlap: 0.9, split: 0.45, minMembersEstablished: 3 };

function point(partial: Omit<ClusterPoint, "vector"> & { vector: number[] }): ClusterPoint {
  return { ...partial, vector: l2normalize(partial.vector) };
}

function evalPoints(vectors: Record<string, number[]>): ClusterPoint[] {
  return CLUSTER_EVAL_REVIEWS.map((review) =>
    point({
      reviewId: review.id,
      workspaceId: review.workspaceId,
      locationId: review.locationId,
      createdAt: review.createdAt,
      topics: withFittingCleanliness(review.text, review.topics),
      severity: review.severity,
      excerpt: review.text,
      vector: vectors[review.id],
    })
  );
}

const vectors: Record<string, number[]> = {
  "fit-1": [1, 0, 0],
  "fit-2": [0.96, 0.28, 0],
  "fit-3": [0.94, 0.34, 0],
  "bill-1": [0, 1, 0],
  "bill-2": [0.08, 0.99, 0],
  "staff-1": [0, 1, 0],
  "staff-2": [0, 0.1, 0.99],
  "floor-1": [1, 0, 0],
  "rare-1": [0.15, 0.1, 0.98],
};

describe("semantic clusters", () => {
  it("keeps praise and complaints of the same topic in different clusters", () => {
    const complaint = point({
      reviewId: "neg-1",
      workspaceId: "ws-1",
      locationId: "loc-a",
      createdAt: "2026-08-01T00:00:00.000Z",
      topics: ["product_variety"],
      polarity: "complaint",
      severity: "low",
      excerpt: "selections are very limited",
      vector: [1, 0, 0],
    });
    const praise = point({
      ...complaint,
      reviewId: "pos-1",
      polarity: "praise",
      excerpt: "good collection",
      vector: [0.99, 0.1, 0],
    });
    const { clusters } = buildClusters({ points: [complaint, praise], thresholds });
    expect(clusters.map((cluster) => cluster.topicKey).sort()).toEqual(["complaint:product_variety", "praise:product_variety"]);
    expect(clusters.find((cluster) => cluster.topicKey.startsWith("complaint:"))?.title).toContain("complaints");
    expect(clusters.find((cluster) => cluster.topicKey.startsWith("praise:"))?.title).toContain("praise");
  });

  it("groups fitting-room cleanliness paraphrases and keeps other delays apart", () => {
    const { clusters } = buildClusters({ points: evalPoints(vectors), thresholds });
    const fitting = clusters.find((cluster) => cluster.members.some((member) => member.reviewId === "fit-1"));
    expect(fitting?.topicKey).toBe("cleanliness+fitting_room");
    expect(fitting?.members.map((member) => member.reviewId).sort()).toEqual(["fit-1", "fit-2", "fit-3"]);
    expect(fitting?.title).toBe("Cleanliness · Fitting-room experience");
    const billing = clusters.find((cluster) => cluster.members.some((member) => member.reviewId === "bill-1"));
    const staff = clusters.find((cluster) => cluster.members.some((member) => member.reviewId === "staff-1"));
    expect(billing?.members.map((member) => member.reviewId).sort()).toEqual(["bill-1", "bill-2"]);
    expect(staff?.members.map((member) => member.reviewId)).toEqual(["staff-1"]);
    expect(billing?.clusterKey).not.toBe(staff?.clusterKey);
    expect(clusters.find((cluster) => cluster.members.some((member) => member.reviewId === "floor-1"))?.topicKey).toBe("cleanliness");
  });

  it("keeps the same cluster key when a later paraphrase arrives", () => {
    const first = buildClusters({
      points: evalPoints(vectors).filter((item) => item.reviewId === "fit-1" || item.reviewId === "fit-2"),
      thresholds,
    });
    const original = first.clusters[0];
    const previous: PreviousCluster[] = [
      {
        clusterKey: original.clusterKey,
        workspaceId: original.workspaceId,
        topicKey: original.topicKey,
        anchorReviewId: original.anchorReviewId,
        memberIds: original.members.map((member) => member.reviewId),
        version: original.version,
        status: "active",
      },
    ];
    const second = buildClusters({
      points: evalPoints(vectors).filter((item) => item.reviewId.startsWith("fit-")),
      thresholds,
      previous,
    });
    const fitting = second.clusters.find((cluster) => cluster.topicKey === "cleanliness+fitting_room");
    expect(fitting?.clusterKey).toBe(original.clusterKey);
    expect(fitting?.members).toHaveLength(3);
    expect(second.events.some((event) => event.event === "created" && event.clusterKey === original.clusterKey)).toBe(false);
  });

  it("records a split and a merge without minting a new key for the surviving issue", () => {
    const shared = point({
      reviewId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      workspaceId: "ws-1",
      locationId: "loc-a",
      createdAt: "2026-08-01T00:00:00.000Z",
      topics: ["billing_delay"],
      severity: "low",
      excerpt: "Billing was slow.",
      vector: [0, 1, 0],
    });
    const sibling = { ...shared, reviewId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", createdAt: "2026-08-02T00:00:00.000Z", excerpt: "Checkout was slow." };
    const rebuilt = buildClusters({
      points: [shared, sibling],
      thresholds,
      previous: [
        {
          clusterKey: makeClusterKey(topicKey(["billing_delay"]), shared.reviewId),
          workspaceId: "ws-1",
          topicKey: "billing_delay",
          anchorReviewId: shared.reviewId,
          memberIds: [shared.reviewId],
          version: 1,
          status: "active",
        },
        {
          clusterKey: makeClusterKey(topicKey(["billing_delay"]), sibling.reviewId),
          workspaceId: "ws-1",
          topicKey: "billing_delay",
          anchorReviewId: sibling.reviewId,
          memberIds: [sibling.reviewId],
          version: 1,
          status: "active",
        },
      ],
    });
    expect(rebuilt.clusters).toHaveLength(1);
    expect(rebuilt.clusters[0].clusterKey).toBe(makeClusterKey("billing_delay", shared.reviewId));
    expect(rebuilt.events.some((event) => event.event === "merged")).toBe(true);
    expect(rebuilt.events.some((event) => event.event === "retired")).toBe(true);

    const left = point({
      reviewId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      workspaceId: "ws-1",
      locationId: "loc-a",
      createdAt: "2026-07-01T00:00:00.000Z",
      topics: ["queue_time"],
      severity: "low",
      excerpt: "The queue was long.",
      vector: [1, 0, 0],
    });
    const right = {
      ...left,
      reviewId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      createdAt: "2026-07-02T00:00:00.000Z",
      excerpt: "Staff never answered.",
      topics: ["queue_time"],
      vector: l2normalize([0, 1, 0]),
    };
    const split = buildClusters({
      points: [left, { ...left, reviewId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", createdAt: "2026-07-03T00:00:00.000Z" }, right, { ...right, reviewId: "ffffffff-ffff-ffff-ffff-ffffffffffff", createdAt: "2026-07-04T00:00:00.000Z" }],
      thresholds,
      previous: [
        {
          clusterKey: makeClusterKey("queue_time", left.reviewId),
          workspaceId: "ws-1",
          topicKey: "queue_time",
          anchorReviewId: left.reviewId,
          memberIds: [left.reviewId, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", right.reviewId, "ffffffff-ffff-ffff-ffff-ffffffffffff"],
          version: 1,
          status: "active",
        },
      ],
    });
    expect(split.clusters).toHaveLength(2);
    expect(split.clusters.some((cluster) => cluster.clusterKey === makeClusterKey("queue_time", left.reviewId))).toBe(true);
    expect(split.events.some((event) => event.event === "split")).toBe(true);
  });

  it("isolates tenants and labels a rare high-severity review without a significance claim", () => {
    const base = evalPoints(vectors);
    const foreign = base
      .filter((item) => item.reviewId === "fit-1")
      .map((item) => ({ ...item, reviewId: "99999999-9999-9999-9999-999999999999", workspaceId: "ws-2" }));
    const { clusters } = buildClusters({
      points: [...base, ...foreign],
      thresholds,
      periodStart: "2026-09-01T00:00:00.000Z",
      baselineStart: "2026-08-01T00:00:00.000Z",
      now: "2026-10-01T00:00:00.000Z",
    });
    const workspaces = new Set(clusters.filter((cluster) => cluster.topicKey === "cleanliness+fitting_room").map((cluster) => cluster.workspaceId));
    expect(workspaces).toEqual(new Set(["ws-1", "ws-2"]));
    const rare = clusters.find((cluster) => cluster.members.some((member) => member.reviewId === "rare-1"));
    expect(rare?.quality).toBe("watch");
    expect(rare?.signals).toContain("severe_rare");
    expect(rare?.signals).toContain("low_sample");
    expect(rare?.evidenceNote.toLowerCase()).not.toMatch(/significant|caus/);
    const view = clusterNavigation(clusters.find((cluster) => cluster.topicKey === "cleanliness+fitting_room" && cluster.workspaceId === "ws-1")!);
    expect(view.locations.map((location) => location.locationId).sort()).toEqual(["loc-a", "loc-b"]);
    expect(view.months.map((month) => month.month)).toEqual(["2026-08", "2026-09"]);
    expect(view.reviews).toHaveLength(3);
  });

  it("chooses the join threshold from the gap between matching and non-matching pairs", () => {
    const choice = chooseJoinThreshold([0.91, 0.84], [0.42, 0.55]);
    expect(choice.separated).toBe(true);
    expect(choice.join).toBeCloseTo(0.695, 2);
    const overlap = chooseJoinThreshold([0.7], [0.74]);
    expect(overlap.separated).toBe(false);
    expect(overlap.join).toBe(0.7);
    expect(clusterQuality(6, 0.6, "low", thresholds)).toBe("broad");
    expect(withFittingCleanliness("The changing area was unhygienic.", [])).toEqual(["cleanliness", "fitting_room"]);
    expect(withFittingCleanliness("The floor near the entrance was dirty.", ["cleanliness"])).toEqual(["cleanliness"]);
    expect(withFittingCleanliness("Billing took forever at the counter.", ["billing_delay"])).toEqual(["billing_delay"]);
  });
});

describe("embeddings", () => {
  it("skips an unchanged review and stores the model with the content hash", () => {
    const text = "The trial room was dirty.";
    expect(embeddingInput(text)).toBe(text);
    expect(embeddingInput("Too short")).toBeNull();
    expect(embeddingInput("Name stays out")).not.toContain("Ada");
    const hash = embeddingContentHash(text);
    const plan = planEmbeddingWork(
      [
        { reviewId: "r1", comment: text },
        { reviewId: "r2", comment: "Fitting rooms need better cleaning." },
      ],
      [{ reviewId: "r1", model: "gemini-embedding-001", contentHash: hash }]
    );
    expect(plan.reuse).toEqual(["r1"]);
    expect(plan.embed.map((item) => item.reviewId)).toEqual(["r2"]);
  });

  it("normalizes a truncated embedding and reports provider failures", async () => {
    const values = fitEmbedding(Array.from({ length: 3072 }, (_, index) => (index === 0 ? 3 : 0)));
    expect(values).toHaveLength(768);
    expect(cosine(values, values)).toBeCloseTo(1, 5);
    const ok = await requestEmbedding("The trial room was dirty.", {
      apiKey: "test-key",
      fetch: async () =>
        new Response(JSON.stringify({ embedding: { values: Array.from({ length: 768 }, () => 0.1) } }), { status: 200 }),
    });
    expect(ok.values).toHaveLength(768);
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    expect(ok.estimatedCostUsd).toBeGreaterThan(0);
    await expect(
      requestEmbedding("The trial room was dirty.", {
        apiKey: "test-key",
        fetch: async () => new Response("quota exceeded", { status: 429 }),
      })
    ).rejects.toThrow(/quota/);
  });
});
