import { createHash } from "node:crypto";
import { TAXONOMY_VERSION, TAXONOMY_V2, isLeafTopic } from "@/lib/intelligence/taxonomy";
import { cosine } from "@/lib/intelligence/vectors";

export const CLUSTER_VERSION = "cluster-v1";
export const CLUSTER_TAXONOMY_VERSION = TAXONOMY_VERSION;

/**
 * Same-topic join, measured on the labelled set in cluster-eval.ts.
 * overlap is stricter and is only for a review whose topic set contains the
 * cluster's set. Different topic sets never join on wording alone.
 */
export interface ClusterThresholds {
  join: number;
  overlap: number;
  split: number;
  minMembersEstablished: number;
}

/**
 * Measured 20 October 2026 on CLUSTER_EVAL_REVIEWS with gemini-embedding-001
 * at 768 dimensions. The weakest fitting-room paraphrase pair scored 0.7786.
 * A dirty-floor review scored 0.772 against a dirty trial room, and the
 * strongest billing or staff delay scored 0.7562. The join threshold is the
 * midpoint of the paraphrase and the floor near-miss, 0.7753. The gap is
 * 0.0067. Wording similarity alone is not a safe join.
 */
export const CLUSTER_THRESHOLDS: ClusterThresholds = {
  join: 0.7753,
  overlap: 0.8553,
  split: 0.5753,
  minMembersEstablished: 3,
};

export type ClusterQuality = "established" | "emerging" | "watch" | "noise" | "broad";

export type ClusterSignalName =
  | "new_in_period"
  | "increase_vs_baseline"
  | "severe_rare"
  | "single_outlet"
  | "cross_location"
  | "buried_in_other"
  | "low_sample";

export interface ClusterPoint {
  reviewId: string;
  workspaceId: string;
  locationId: string;
  createdAt: string;
  topics: string[];
  /** Praise and complaint of the same topic never share a cluster. Omitted on older points, which keep an unprefixed key. */
  polarity?: "praise" | "complaint";
  severity: "none" | "low" | "moderate" | "high";
  vector: number[];
  excerpt: string;
  intelligenceId?: string | null;
}

export interface ClusterMemberView {
  reviewId: string;
  locationId: string;
  createdAt: string;
  excerpt: string;
  distance: number;
  intelligenceId: string | null;
}

export interface BuiltCluster {
  clusterKey: string;
  workspaceId: string;
  topicKey: string;
  title: string;
  description: string;
  anchorReviewId: string;
  representativeReviewId: string;
  members: ClusterMemberView[];
  confidence: number;
  quality: ClusterQuality;
  signals: ClusterSignalName[];
  evidenceNote: string;
  meanSimilarity: number;
  version: number;
  status: "active";
}

export interface ClusterEvent {
  event: "created" | "joined" | "merged" | "split" | "retired";
  clusterKey: string;
  relatedClusterKey: string | null;
  reviewIds: string[];
  detail: string;
}

export interface PreviousCluster {
  clusterKey: string;
  workspaceId: string;
  topicKey: string;
  anchorReviewId: string;
  memberIds: string[];
  version: number;
  status: "active" | "retired";
}

export interface ClusterBuildInput {
  points: ClusterPoint[];
  thresholds?: ClusterThresholds;
  previous?: PreviousCluster[];
  /** Start of the current window. The previous window ends here. */
  periodStart?: string;
  /** Start of the comparison window. */
  baselineStart?: string;
  now?: string;
}

const FITTING_ALIASES = ["trial room", "changing room", "changing area", "fitting room", "fitting rooms"];
const CLEAN_ALIASES = ["hygiene", "dirty", "clean", "cleaning", "unhygienic"];

function mentions(text: string, alias: string): boolean {
  const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return pattern.test(text);
}

/**
 * A fitting-room cleanliness complaint often arrives as two phrases.
 * When the text itself names both, both leaf codes are kept so paraphrases
 * share a topic set. Other topics are not inferred from wording.
 */
export function withFittingCleanliness(text: string, topics: readonly string[]): string[] {
  const leaves = topics.filter((code) => isLeafTopic(code));
  const fitting = FITTING_ALIASES.some((alias) => mentions(text, alias));
  const clean = CLEAN_ALIASES.some((alias) => mentions(text, alias));
  if (fitting) leaves.push("fitting_room");
  if (fitting && clean) leaves.push("cleanliness");
  return [...new Set(leaves)].sort();
}

export function topicKey(topics: readonly string[], polarity?: "praise" | "complaint"): string {
  const body = [...new Set(topics.filter((code) => isLeafTopic(code)))].sort().join("+");
  if (!body || !polarity) return body;
  return `${polarity}:${body}`;
}

export function clusterTitle(key: string): string {
  if (!key) return "Ungrouped";
  const polarity = key.startsWith("praise:") ? "praise" : key.startsWith("complaint:") ? "complaint" : null;
  const body = polarity ? key.slice(polarity.length + 1) : key;
  const label = body
    .split("+")
    .map((code) => TAXONOMY_V2.find((node) => node.code === code)?.label ?? code)
    .join(" · ");
  if (polarity === "praise") return `${label} — praise`;
  if (polarity === "complaint") return `${label} — complaints`;
  return label;
}

export function makeClusterKey(key: string, anchorReviewId: string): string {
  const topic = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `c${topic}-${anchorReviewId}`;
}

export function clusterQuality(
  size: number,
  meanSimilarity: number,
  maxSeverity: ClusterPoint["severity"],
  thresholds: ClusterThresholds
): ClusterQuality {
  if (size >= 3 && meanSimilarity < thresholds.join) return "broad";
  if (size === 1 && maxSeverity === "high") return "watch";
  if (size === 1) return "noise";
  if (size >= thresholds.minMembersEstablished && meanSimilarity >= thresholds.join) return "established";
  if (size >= 2) return "emerging";
  return "noise";
}

function evidenceNote(quality: ClusterQuality, signals: ClusterSignalName[]): string {
  if (signals.includes("increase_vs_baseline")) {
    return "The current window has at least twice as many reviews as the previous window of the same length. This is a count comparison.";
  }
  if (signals.includes("severe_rare")) {
    return "At least one review is high severity and the cluster has fewer than three reviews. The sample is small.";
  }
  if (quality === "noise") return "A single review is not treated as a recurring issue.";
  if (quality === "broad") return "Members are weakly related. The cluster is not specific enough to act on as one issue.";
  if (signals.includes("low_sample")) return "Fewer than three reviews support this cluster.";
  if (signals.includes("new_in_period")) return "This cluster has no reviews in the previous window.";
  return "Members share a topic set and are near the cluster representative.";
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

interface Working {
  clusterKey: string;
  workspaceId: string;
  topicKey: string;
  anchorReviewId: string;
  points: ClusterPoint[];
  representative: ClusterPoint;
  version: number;
}

function representativeOf(points: ClusterPoint[]): ClusterPoint {
  if (points.length === 1) return points[0];
  let best = points[0];
  let bestScore = -Infinity;
  for (const candidate of points) {
    const score = points.reduce((sum, other) => sum + cosine(candidate.vector, other.vector), 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function meanToRepresentative(points: ClusterPoint[], representative: ClusterPoint): number {
  if (points.length === 1) return 1;
  const others = points.filter((point) => point.reviewId !== representative.reviewId);
  const total = others.reduce((sum, point) => sum + cosine(point.vector, representative.vector), 0);
  return total / others.length;
}

function maxSeverity(points: ClusterPoint[]): ClusterPoint["severity"] {
  const rank = { none: 0, low: 1, moderate: 2, high: 3 };
  return points.reduce<ClusterPoint["severity"]>((best, point) => (rank[point.severity] > rank[best] ? point.severity : best), "none");
}

function canJoin(point: ClusterPoint, cluster: Working, thresholds: ClusterThresholds): boolean {
  if (point.workspaceId !== cluster.workspaceId) return false;
  const key = topicKey(point.topics, point.polarity);
  if (!key || key !== cluster.topicKey) return false;
  const similarity = cosine(point.vector, cluster.representative.vector);
  const mean = meanToRepresentative(cluster.points, cluster.representative);
  const bar = cluster.points.length >= 3 && mean < thresholds.join ? thresholds.overlap : thresholds.join;
  return similarity >= bar;
}

function signalsFor(cluster: Working, input: ClusterBuildInput, mean: number): ClusterSignalName[] {
  const signals: ClusterSignalName[] = [];
  const size = cluster.points.length;
  const thresholds = input.thresholds ?? CLUSTER_THRESHOLDS;
  if (size < thresholds.minMembersEstablished) signals.push("low_sample");
  if (maxSeverity(cluster.points) === "high" && size < thresholds.minMembersEstablished) signals.push("severe_rare");
  if (cluster.topicKey === "other" || cluster.topicKey.startsWith("other+") || cluster.topicKey.endsWith("+other")) {
    signals.push("buried_in_other");
  }
  const locations = new Map<string, number>();
  for (const point of cluster.points) locations.set(point.locationId, (locations.get(point.locationId) ?? 0) + 1);
  const top = Math.max(...locations.values());
  if (size >= 3 && locations.size === 1) signals.push("single_outlet");
  else if (size >= 3 && top / size >= 0.8 && locations.size > 1) signals.push("single_outlet");
  if (size >= 3 && locations.size >= 2) signals.push("cross_location");
  if (input.periodStart && input.baselineStart) {
    const end = input.now ?? "9999-12-31";
    const current = cluster.points.filter((point) => point.createdAt >= input.periodStart! && point.createdAt < end).length;
    const previous = cluster.points.filter(
      (point) => point.createdAt >= input.baselineStart! && point.createdAt < input.periodStart!
    ).length;
    if (previous === 0 && current >= 2) signals.push("new_in_period");
    if (previous >= 1 && current >= 2 && current >= previous * 2) signals.push("increase_vs_baseline");
  }
  if (mean < thresholds.join && size >= 3 && !signals.includes("low_sample")) signals.push("low_sample");
  return signals;
}

function toBuilt(cluster: Working, input: ClusterBuildInput): BuiltCluster {
  const representative = cluster.representative;
  const mean = meanToRepresentative(cluster.points, representative);
  const quality = clusterQuality(cluster.points.length, mean, maxSeverity(cluster.points), input.thresholds ?? CLUSTER_THRESHOLDS);
  const signals = signalsFor(cluster, input, mean);
  const members: ClusterMemberView[] = cluster.points
    .map((point) => ({
      reviewId: point.reviewId,
      locationId: point.locationId,
      createdAt: point.createdAt,
      excerpt: point.excerpt,
      distance: Number((1 - cosine(point.vector, representative.vector)).toFixed(4)),
      intelligenceId: point.intelligenceId ?? null,
    }))
    .sort((a, b) => a.distance - b.distance || a.reviewId.localeCompare(b.reviewId));
  const confidence = Number(
    Math.max(0, Math.min(0.99, quality === "noise" ? 0.2 : quality === "watch" ? 0.4 : quality === "broad" ? Math.min(0.5, mean) : mean * Math.min(1, cluster.points.length / 5))).toFixed(3)
  );
  return {
    clusterKey: cluster.clusterKey,
    workspaceId: cluster.workspaceId,
    topicKey: cluster.topicKey,
    title: clusterTitle(cluster.topicKey),
    description: representative.excerpt.slice(0, 240),
    anchorReviewId: cluster.anchorReviewId,
    representativeReviewId: representative.reviewId,
    members,
    confidence,
    quality,
    signals,
    evidenceNote: evidenceNote(quality, signals),
    meanSimilarity: Number(mean.toFixed(4)),
    version: cluster.version,
    status: "active",
  };
}

function preserveIdentity(built: BuiltCluster[], previous: PreviousCluster[], events: ClusterEvent[]): BuiltCluster[] {
  const remaining = previous.filter((item) => item.status === "active");
  const used = new Set<string>();
  const ordered = [...built].sort((a, b) => b.members.length - a.members.length || a.anchorReviewId.localeCompare(b.anchorReviewId));
  const adopted = new Map<string, BuiltCluster>();
  for (const cluster of ordered) {
    let best: PreviousCluster | null = null;
    let bestScore = 0;
    for (const prev of remaining) {
      if (used.has(prev.clusterKey) || prev.workspaceId !== cluster.workspaceId) continue;
      const overlap = cluster.members.filter((member) => prev.memberIds.includes(member.reviewId)).length;
      const score = (prev.anchorReviewId === cluster.anchorReviewId ? 100 : 0) + overlap;
      if (score > bestScore) {
        best = prev;
        bestScore = score;
      }
    }
    const half = Math.ceil(cluster.members.length / 2);
    if (best && (best.anchorReviewId === cluster.anchorReviewId || bestScore >= half)) {
      used.add(best.clusterKey);
      adopted.set(cluster.clusterKey, { ...cluster, clusterKey: best.clusterKey, version: best.version });
    } else {
      const source = remaining.find(
        (prev) =>
          prev.workspaceId === cluster.workspaceId &&
          cluster.members.some((member) => prev.memberIds.includes(member.reviewId))
      );
      events.push({
        event: source ? "split" : "created",
        clusterKey: cluster.clusterKey,
        relatedClusterKey: source?.clusterKey ?? null,
        reviewIds: cluster.members.map((member) => member.reviewId),
        detail: source
          ? "These reviews left an earlier cluster and kept their own key."
          : "No earlier cluster matched these reviews.",
      });
      adopted.set(cluster.clusterKey, cluster);
    }
  }
  const survivorByMembers = [...adopted.values()];
  for (const prev of remaining) {
    if (used.has(prev.clusterKey)) continue;
    const survivor = survivorByMembers.find(
      (cluster) =>
        cluster.workspaceId === prev.workspaceId &&
        prev.memberIds.every((id) => cluster.members.some((member) => member.reviewId === id))
    );
    if (survivor) {
      events.push({
        event: "merged",
        clusterKey: survivor.clusterKey,
        relatedClusterKey: prev.clusterKey,
        reviewIds: prev.memberIds,
        detail: "Reviews from an earlier cluster now belong here. The earlier key is retired.",
      });
    }
    events.push({
      event: "retired",
      clusterKey: prev.clusterKey,
      relatedClusterKey: survivor?.clusterKey ?? null,
      reviewIds: prev.memberIds,
      detail: "This cluster key has no current membership.",
    });
  }
  for (const cluster of adopted.values()) {
    const created = events.some((event) => event.event === "created" && event.clusterKey === cluster.clusterKey);
    if (!created && !events.some((event) => event.clusterKey === cluster.clusterKey && event.event === "split")) {
      events.push({
        event: "joined",
        clusterKey: cluster.clusterKey,
        relatedClusterKey: null,
        reviewIds: cluster.members.map((member) => member.reviewId),
        detail: "Membership refreshed on the existing cluster key.",
      });
    }
  }
  return built.map((cluster) => adopted.get(cluster.clusterKey) ?? cluster);
}

export function buildClusters(input: ClusterBuildInput): { clusters: BuiltCluster[]; events: ClusterEvent[] } {
  const thresholds = input.thresholds ?? CLUSTER_THRESHOLDS;
  const ordered = [...input.points].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.reviewId.localeCompare(b.reviewId)
  );
  const working: Working[] = [];
  for (const point of ordered) {
    const key = topicKey(point.topics, point.polarity);
    if (!key || point.vector.length === 0) continue;
    let best: Working | null = null;
    let bestSimilarity = -Infinity;
    for (const cluster of working) {
      if (!canJoin(point, cluster, thresholds)) continue;
      const similarity = cosine(point.vector, cluster.representative.vector);
      if (similarity > bestSimilarity) {
        best = cluster;
        bestSimilarity = similarity;
      }
    }
    if (!best) {
      working.push({
        clusterKey: makeClusterKey(key, point.reviewId),
        workspaceId: point.workspaceId,
        topicKey: key,
        anchorReviewId: point.reviewId,
        points: [point],
        representative: point,
        version: 1,
      });
      continue;
    }
    best.points.push(point);
    best.representative = representativeOf(best.points);
    const weak = best.points.filter(
      (member) => member.reviewId !== best!.representative.reviewId && cosine(member.vector, best!.representative.vector) < thresholds.split
    );
    if (weak.length >= 2 && best.points.length - weak.length >= 2) {
      const stay = best.points.filter((member) => !weak.includes(member));
      best.points = stay;
      best.representative = representativeOf(stay);
      const anchor = [...weak].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.reviewId.localeCompare(b.reviewId))[0];
      working.push({
        clusterKey: makeClusterKey(best.topicKey, anchor.reviewId),
        workspaceId: best.workspaceId,
        topicKey: best.topicKey,
        anchorReviewId: anchor.reviewId,
        points: weak,
        representative: representativeOf(weak),
        version: 1,
      });
    }
  }
  const built = working.map((cluster) => toBuilt(cluster, input));
  const events: ClusterEvent[] = [];
  const clusters = input.previous ? preserveIdentity(built, input.previous, events) : built;
  if (!input.previous) {
    for (const cluster of clusters) {
      events.push({
        event: "created",
        clusterKey: cluster.clusterKey,
        relatedClusterKey: null,
        reviewIds: cluster.members.map((member) => member.reviewId),
        detail: "First build for these reviews.",
      });
    }
  }
  return { clusters, events };
}

export interface ClusterNavigation {
  clusterKey: string;
  title: string;
  description: string;
  quality: ClusterQuality;
  confidence: number;
  signals: ClusterSignalName[];
  evidenceNote: string;
  reviews: ClusterMemberView[];
  locations: Array<{ locationId: string; count: number }>;
  months: Array<{ month: string; count: number }>;
}

export function clusterNavigation(cluster: BuiltCluster): ClusterNavigation {
  const locations = new Map<string, number>();
  const months = new Map<string, number>();
  for (const member of cluster.members) {
    locations.set(member.locationId, (locations.get(member.locationId) ?? 0) + 1);
    const month = monthKey(member.createdAt);
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  return {
    clusterKey: cluster.clusterKey,
    title: cluster.title,
    description: cluster.description,
    quality: cluster.quality,
    confidence: cluster.confidence,
    signals: cluster.signals,
    evidenceNote: cluster.evidenceNote,
    reviews: cluster.members,
    locations: [...locations.entries()]
      .map(([locationId, count]) => ({ locationId, count }))
      .sort((a, b) => b.count - a.count || a.locationId.localeCompare(b.locationId)),
    months: [...months.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}
