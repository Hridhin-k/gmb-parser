import type { Json } from "@/lib/types/supabase";
import type { createAdminClient } from "@/lib/supabase/admin";
import { EMBEDDING_MODEL } from "@/lib/intelligence/embed";
import {
  CLUSTER_TAXONOMY_VERSION,
  CLUSTER_THRESHOLDS,
  type BuiltCluster,
  type ClusterEvent,
  type ClusterPoint,
  type PreviousCluster,
  buildClusters,
  withFittingCleanliness,
} from "@/lib/intelligence/cluster";
import { logger } from "@/lib/logger";

type Admin = ReturnType<typeof createAdminClient>;

export interface StoredClusterReview {
  reviewId: string;
  workspaceId: string;
  locationId: string;
  createdAt: string;
  comment: string | null;
  topics: string[];
  polarity?: "praise" | "complaint";
  severity: ClusterPoint["severity"];
  vector: number[];
  excerpt: string;
  intelligenceId?: string | null;
}

export function pointsFromReviews(reviews: StoredClusterReview[]): ClusterPoint[] {
  return reviews.map((review) => ({
    reviewId: review.reviewId,
    workspaceId: review.workspaceId,
    locationId: review.locationId,
    createdAt: review.createdAt,
    topics: withFittingCleanliness(review.excerpt || review.comment || "", review.topics),
    polarity: review.polarity,
    severity: review.severity,
    vector: review.vector,
    excerpt: review.excerpt,
    intelligenceId: review.intelligenceId ?? null,
  }));
}

export async function persistClusterBuild(
  admin: Admin,
  workspaceId: string,
  clusters: BuiltCluster[],
  events: ClusterEvent[]
): Promise<void> {
  for (const cluster of clusters) {
    const payload = {
      workspace_id: workspaceId,
      cluster_key: cluster.clusterKey,
      taxonomy_version: CLUSTER_TAXONOMY_VERSION,
      description: cluster.description,
      version: cluster.version,
      status: "active" as const,
      model: EMBEDDING_MODEL,
      topic_key: cluster.topicKey,
      title: cluster.title,
      confidence: cluster.confidence,
      quality: cluster.quality,
      stats: {
        reviewCount: cluster.members.length,
        meanSimilarity: cluster.meanSimilarity,
        evidenceNote: cluster.evidenceNote,
      } as Json,
      evidence: cluster.members.slice(0, 3).map((member) => ({
        reviewId: member.reviewId,
        excerpt: member.excerpt,
        distance: member.distance,
      })) as Json,
      signals: cluster.signals as unknown as Json,
    };
    const { data: existing, error: lookupError } = await admin
      .from("grm_semantic_clusters")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("cluster_key", cluster.clusterKey)
      .eq("taxonomy_version", CLUSTER_TAXONOMY_VERSION)
      .eq("version", cluster.version)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    let clusterId = existing?.id ?? null;
    if (clusterId) {
      const { error } = await admin.from("grm_semantic_clusters").update(payload).eq("id", clusterId).eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await admin.from("grm_semantic_clusters").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      clusterId = data.id;
    }
    const { error: clearError } = await admin
      .from("grm_cluster_members")
      .delete()
      .eq("cluster_id", clusterId)
      .eq("workspace_id", workspaceId);
    if (clearError) throw new Error(clearError.message);
    if (cluster.members.length > 0) {
      const { error } = await admin.from("grm_cluster_members").insert(
        cluster.members.map((member) => ({
          cluster_id: clusterId,
          review_id: member.reviewId,
          workspace_id: workspaceId,
          intelligence_id: member.intelligenceId,
          distance: member.distance,
        }))
      );
      if (error) throw new Error(error.message);
    }
  }

  for (const event of events) {
    const retireKey = event.event === "retired" ? event.clusterKey : event.event === "merged" ? event.relatedClusterKey : null;
    if (retireKey) {
      const { error } = await admin
        .from("grm_semantic_clusters")
        .update({ status: "retired" })
        .eq("workspace_id", workspaceId)
        .eq("cluster_key", retireKey)
        .eq("status", "active");
      if (error) throw new Error(error.message);
    }
    const { error } = await admin.from("grm_cluster_events").insert({
      workspace_id: workspaceId,
      cluster_key: event.clusterKey,
      event: event.event,
      related_cluster_key: event.relatedClusterKey,
      review_ids: event.reviewIds,
      detail: { text: event.detail } as Json,
    });
    if (error) throw new Error(error.message);
  }
}

export async function loadPreviousClusters(admin: Admin, workspaceId: string): Promise<PreviousCluster[]> {
  const { data, error } = await admin
    .from("grm_semantic_clusters")
    .select("id, cluster_key, topic_key, version, status")
    .eq("workspace_id", workspaceId)
    .eq("taxonomy_version", CLUSTER_TAXONOMY_VERSION);
  if (error) throw new Error(error.message);
  const clusters = data ?? [];
  if (clusters.length === 0) return [];
  const { data: members, error: memberError } = await admin
    .from("grm_cluster_members")
    .select("cluster_id, review_id")
    .eq("workspace_id", workspaceId)
    .in(
      "cluster_id",
      clusters.map((cluster) => cluster.id)
    );
  if (memberError) throw new Error(memberError.message);
  return clusters.map((cluster) => {
    const memberIds = (members ?? []).filter((member) => member.cluster_id === cluster.id).map((member) => member.review_id);
    return {
      clusterKey: cluster.cluster_key,
      workspaceId,
      topicKey: cluster.topic_key,
      anchorReviewId: cluster.cluster_key.slice(14) || memberIds[0] || cluster.cluster_key,
      memberIds,
      version: cluster.version,
      status: cluster.status === "retired" ? "retired" : "active",
    };
  });
}

export function rebuildFromPoints(points: ClusterPoint[], previous: PreviousCluster[] = []) {
  return buildClusters({
    points,
    previous,
    thresholds: CLUSTER_THRESHOLDS,
    periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    baselineStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    now: new Date().toISOString(),
  });
}

export interface ClusterBoardReview {
  reviewId: string;
  locationId: string;
  locationTitle: string;
  createdAt: string;
  excerpt: string;
  href: string;
}

export interface ClusterBoardItem {
  clusterKey: string;
  title: string;
  description: string;
  quality: string;
  confidence: number | null;
  signals: string[];
  evidenceNote: string;
  reviews: ClusterBoardReview[];
  locations: Array<{ locationId: string; title: string; count: number }>;
  months: Array<{ month: string; count: number }>;
}

export async function loadClusterBoard(
  admin: Admin,
  workspaceId: string,
  scope?: { locationIds: readonly string[]; maxReviews?: number }
): Promise<{ items: ClusterBoardItem[]; unavailable: string | null }> {
  if (scope && scope.locationIds.length === 0) return { items: [], unavailable: null };
  const { data: clusters, error } = await admin
    .from("grm_semantic_clusters")
    .select("id, cluster_key, title, description, quality, confidence, signals, stats, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) {
    logger.warn("clusters.board_unavailable", { message: error.message });
    return { items: [], unavailable: "Topic clusters are not available in this workspace yet." };
  }
  if (!clusters || clusters.length === 0) return { items: [], unavailable: null };
  const ids = clusters.map((cluster) => cluster.id);
  const { data: members, error: memberError } = await admin
    .from("grm_cluster_members")
    .select("cluster_id, review_id, distance")
    .eq("workspace_id", workspaceId)
    .in("cluster_id", ids);
  if (memberError) throw new Error(memberError.message);
  const reviewIds = [...new Set((members ?? []).map((member) => member.review_id))];
  const { data: reviews, error: reviewError } = reviewIds.length
    ? await admin
        .from("grm_reviews")
        .select("id, location_id, review_create_time, comment")
        .eq("workspace_id", workspaceId)
        .in("id", reviewIds)
    : { data: [], error: null };
  if (reviewError) throw new Error(reviewError.message);
  const locationIds = [...new Set((reviews ?? []).map((review) => review.location_id))];
  const { data: locations, error: locationError } = locationIds.length
    ? await admin.from("grm_google_locations").select("id, location_title").eq("workspace_id", workspaceId).in("id", locationIds)
    : { data: [], error: null };
  if (locationError) throw new Error(locationError.message);
  const locationTitle = new Map((locations ?? []).map((location) => [location.id, location.location_title]));
  const reviewById = new Map((reviews ?? []).map((review) => [review.id, review]));

  const items: ClusterBoardItem[] = clusters.map((cluster) => {
    const stats = (cluster.stats ?? {}) as { evidenceNote?: string };
    const signals = Array.isArray(cluster.signals) ? cluster.signals.filter((item): item is string => typeof item === "string") : [];
    const rows = (members ?? []).filter((member) => member.cluster_id === cluster.id);
    const boardReviews: ClusterBoardReview[] = rows.flatMap((member) => {
      const review = reviewById.get(member.review_id);
      if (!review) return [];
      return [
        {
          reviewId: review.id,
          locationId: review.location_id,
          locationTitle: locationTitle.get(review.location_id) ?? "Location",
          createdAt: review.review_create_time,
          excerpt: (review.comment ?? "").slice(0, 180),
          href: `/reviews?review=${review.id}`,
        },
      ];
    });
    const locationCounts = new Map<string, { title: string; count: number }>();
    const monthCounts = new Map<string, number>();
    for (const review of boardReviews) {
      const current = locationCounts.get(review.locationId) ?? { title: review.locationTitle, count: 0 };
      current.count += 1;
      locationCounts.set(review.locationId, current);
      const month = review.createdAt.slice(0, 7);
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    }
    return {
      clusterKey: cluster.cluster_key,
      title: cluster.title || "Untitled cluster",
      description: cluster.description,
      quality: cluster.quality,
      confidence: cluster.confidence,
      signals,
      evidenceNote: stats.evidenceNote ?? "",
      reviews: boardReviews,
      locations: [...locationCounts.entries()]
        .map(([locationId, value]) => ({ locationId, title: value.title, count: value.count }))
        .sort((a, b) => b.count - a.count),
      months: [...monthCounts.entries()]
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  });
  if (!scope) return { items, unavailable: null };
  const allowed = new Set(scope.locationIds);
  const limit = scope.maxReviews ?? 3;
  const scoped = items.flatMap((item) => {
    const reviews = item.reviews.filter((review) => allowed.has(review.locationId)).slice(0, limit);
    if (reviews.length === 0) return [];
    const locationCounts = new Map<string, { title: string; count: number }>();
    const monthCounts = new Map<string, number>();
    for (const review of reviews) {
      const current = locationCounts.get(review.locationId) ?? { title: review.locationTitle, count: 0 };
      current.count += 1;
      locationCounts.set(review.locationId, current);
      const month = review.createdAt.slice(0, 7);
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    }
    return [{
      ...item,
      reviews,
      locations: [...locationCounts.entries()].map(([locationId, value]) => ({ locationId, title: value.title, count: value.count })),
      months: [...monthCounts.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    }];
  });
  return { items: scoped, unavailable: null };
}
