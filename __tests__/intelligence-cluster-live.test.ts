import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLUSTER_EVAL_REVIEWS, chooseJoinThreshold } from "@/lib/intelligence/cluster-eval";
import { buildClusters, clusterNavigation, withFittingCleanliness } from "@/lib/intelligence/cluster";
import { requestEmbedding } from "@/lib/intelligence/embed";
import { aliasTopics } from "@/lib/intelligence/taxonomy";
import { cosine } from "@/lib/intelligence/vectors";
import { createAdminClient } from "@/lib/supabase/admin";

function loadLocalEnv(): void {
  if (process.env.GEMINI_API_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

const live = process.env.LIVE_EMBED === "1";

describe.skipIf(!live)("live embedding evaluation", () => {
  it("measures the labelled set and clusters stored reviews", async () => {
    loadLocalEnv();
    const started = Date.now();
    const embedded = new Map<string, number[]>();
    let cost = 0;
    for (const review of CLUSTER_EVAL_REVIEWS) {
      const result = await requestEmbedding(review.text);
      embedded.set(review.id, result.values);
      cost += result.estimatedCostUsd;
    }
    const fitting = CLUSTER_EVAL_REVIEWS.filter((review) => review.group === "fitting-clean").map((review) => review.id);
    const positive: number[] = [];
    for (let i = 0; i < fitting.length; i++) {
      for (let j = i + 1; j < fitting.length; j++) {
        positive.push(cosine(embedded.get(fitting[i])!, embedded.get(fitting[j])!));
      }
    }
    const negative: number[] = [];
    for (const id of fitting) {
      for (const other of CLUSTER_EVAL_REVIEWS) {
        if (other.group === "fitting-clean") continue;
        negative.push(cosine(embedded.get(id)!, embedded.get(other.id)!));
      }
    }
    const choice = chooseJoinThreshold(positive, negative);
    const { clusters } = buildClusters({
      points: CLUSTER_EVAL_REVIEWS.map((review) => ({
        reviewId: review.id,
        workspaceId: review.workspaceId,
        locationId: review.locationId,
        createdAt: review.createdAt,
        topics: withFittingCleanliness(review.text, review.topics),
        severity: review.severity,
        vector: embedded.get(review.id)!,
        excerpt: review.text,
      })),
      thresholds: { join: choice.join, overlap: Math.min(0.95, choice.join + 0.08), split: Math.max(0.2, choice.join - 0.2), minMembersEstablished: 3 },
    });
    const fittingCluster = clusters.find((cluster) => cluster.members.some((member) => member.reviewId === "fit-1"));
    const billing = clusters.find((cluster) => cluster.members.some((member) => member.reviewId === "bill-1"));
    const staff = clusters.find((cluster) => cluster.members.some((member) => member.reviewId === "staff-1"));
    expect(fittingCluster?.members.map((member) => member.reviewId).sort()).toEqual(["fit-1", "fit-2", "fit-3"]);
    expect(billing?.clusterKey).not.toBe(staff?.clusterKey);
    expect(JSON.stringify(clusterNavigation(fittingCluster!))).not.toMatch(/significant/i);

    const admin = createAdminClient();
    const floor = cosine(embedded.get("floor-1")!, embedded.get("fit-1")!);
    const { data: reviews, error } = await admin
      .from("grm_reviews")
      .select("id, workspace_id, location_id, comment, review_create_time")
      .not("comment", "is", null)
      .order("review_create_time", { ascending: false })
      .limit(12);
    expect(error).toBeNull();
    const stored = [];
    for (const review of reviews ?? []) {
      if (!review.comment || review.comment.trim().length < 12) continue;
      const result = await requestEmbedding(review.comment);
      cost += result.estimatedCostUsd;
      const topics = withFittingCleanliness(review.comment, aliasTopics(review.comment));
      if (topics.length === 0) continue;
      stored.push({
        reviewId: review.id,
        workspaceId: review.workspace_id,
        locationId: review.location_id,
        createdAt: review.review_create_time,
        topics,
        severity: "low" as const,
        vector: result.values,
        excerpt: review.comment.slice(0, 140),
      });
    }
    const storedBuild = buildClusters({
      points: stored,
      thresholds: { join: choice.join, overlap: Math.min(0.95, choice.join + 0.08), split: Math.max(0.2, choice.join - 0.2), minMembersEstablished: 3 },
    });
    const report = storedBuild.clusters.map(clusterNavigation);
    console.log(JSON.stringify({
      evalMs: Date.now() - started,
      estimatedCostUsd: Number(cost.toFixed(6)),
      minPositive: choice.minPositive,
      maxNegative: choice.maxNegative,
      floorToFitting: Number(floor.toFixed(4)),
      join: choice.join,
      separated: choice.separated,
      gap: choice.gap,
      storedWithTopic: stored.length,
      storedFetched: (reviews ?? []).length,
      storedClusters: report.map((item) => ({
        title: item.title,
        workspaceId: storedBuild.clusters.find((cluster) => cluster.clusterKey === item.clusterKey)?.workspaceId,
        quality: item.quality,
        confidence: item.confidence,
        note: item.evidenceNote,
        reviews: item.reviews.length,
        locations: item.locations,
        months: item.months,
      })),
    }, null, 2));
    expect(choice.minPositive).toBeGreaterThan(0);
  }, 180_000);
});
