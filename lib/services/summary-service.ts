import type { Json } from "@/lib/types/supabase";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { loadScopeCatalog } from "@/lib/services/scope-catalog";
import { readScopeRequest, type ScopeRequest } from "@/lib/scope";
import { SUMMARY_DEFAULT_TIMEZONE, assertSummaryTimezone, summaryWindow, type SummaryWindow } from "@/lib/intelligence/summary-window";
import { authorizeSummaryScope, type AuthorizedSummaryScope } from "@/lib/intelligence/summary-scope";
import {
  SUMMARY_ANALYSIS_VERSION,
  SUMMARY_PROMPT_VERSION,
  beginSummaryJob,
  buildSummaryDocument,
  reviewTouchesSummary,
  summaryIdentityFor,
  summaryIdentityHash,
  summaryNarrative,
  summaryReuse,
  type StoredSummaryRef,
  type SummaryDocument,
  type SummaryReview,
} from "@/lib/intelligence/summary-aggregate";
import type { DateRange } from "@/lib/date-range";
import { membershipHash } from "@/lib/intelligence/identity";
import { projectOrgSummary, type OrgSummaryState } from "@/lib/intelligence/org-summary";
import { INSIGHT_PROMPT_VERSION } from "@/lib/intelligence/insight";
import { excerptSupportsClaim } from "@/lib/intelligence/claim-support";
import { EXTRACT_ANALYSIS_VERSION } from "@/lib/intelligence/extraction";
import { locationInGroup } from "@/lib/hierarchy";

type Admin = ReturnType<typeof createAdminClient>;

const REFRESH_BATCH = 2;
const ENQUEUE_LIMIT = 5;

export interface SummaryResult {
  status: "ready" | "processing";
  reused: boolean;
  summaryId: string | null;
  document: SummaryDocument | null;
  narrative: string | null;
}

function stringsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asExtraction(value: Json): {
  overall: SummaryReview["overall"];
  topics: string[];
  issues: string[];
  praise: string[];
  excerpts: SummaryReview["excerpts"];
  aspects: NonNullable<SummaryReview["aspects"]>;
  staffMentions: string[];
  requests: string[];
  severe: boolean;
} {
  const empty = {
    overall: null,
    topics: [] as string[],
    issues: [] as string[],
    praise: [] as string[],
    excerpts: [] as SummaryReview["excerpts"],
    aspects: [] as NonNullable<SummaryReview["aspects"]>,
    staffMentions: [] as string[],
    requests: [] as string[],
    severe: false,
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const record = value as {
    interpretation?: { overall?: SummaryReview["overall"]; severity?: string; staffMentions?: unknown; requests?: unknown };
    facts?: { quotations?: Array<{ topicCode?: string; polarity?: string; excerpt?: string; phrase?: string; uncertain?: boolean }> };
  };
  const quotations = record.facts?.quotations ?? [];
  const topics = new Set<string>();
  const issues = new Set<string>();
  const praise = new Set<string>();
  const excerpts: SummaryReview["excerpts"] = [];
  const aspects: NonNullable<SummaryReview["aspects"]> = [];
  for (const quotation of quotations) {
    if (!quotation.topicCode || quotation.uncertain === true) continue;
    if (
      (quotation.polarity === "complaint" || quotation.polarity === "praise") &&
      !excerptSupportsClaim(quotation.topicCode, quotation.polarity, quotation.excerpt ?? quotation.phrase ?? "")
    ) {
      continue;
    }
    topics.add(quotation.topicCode);
    if (quotation.polarity === "complaint") issues.add(quotation.topicCode);
    if (quotation.polarity === "praise") praise.add(quotation.topicCode);
    if ((quotation.polarity === "complaint" || quotation.polarity === "praise") && quotation.excerpt) {
      excerpts.push({ topicCode: quotation.topicCode, polarity: quotation.polarity, text: quotation.excerpt });
    }
    if (quotation.phrase && (quotation.polarity === "praise" || quotation.polarity === "complaint" || quotation.polarity === "neutral")) {
      aspects.push({ phrase: quotation.phrase, topicCode: quotation.topicCode, polarity: quotation.polarity });
    }
  }
  const overall = record.interpretation?.overall ?? null;
  return {
    overall,
    topics: [...topics],
    issues: [...issues],
    praise: [...praise],
    excerpts,
    aspects,
    staffMentions: stringsFrom(record.interpretation?.staffMentions),
    requests: stringsFrom(record.interpretation?.requests),
    severe: record.interpretation?.severity === "high",
  };
}

export async function loadSummaryReviews(
  admin: Admin,
  workspaceId: string,
  locationIds: readonly string[]
): Promise<SummaryReview[]> {
  if (locationIds.length === 0) return [];
  const reviews: SummaryReview[] = [];
  // PostgREST caps one response at 1,000 rows, so page with range() until a
  // short page arrives. Ordering by id keeps the pages stable between calls.
  const PAGE_SIZE = 1000;
  const MAX_SUMMARY_REVIEWS = 50_000;
  for (let offset = 0; offset < locationIds.length; offset += 100) {
    const slice = locationIds.slice(offset, offset + 100);
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from("grm_reviews")
        .select("id, location_id, star_rating, review_create_time, content_fingerprint, missing_on_google_at")
        .eq("workspace_id", workspaceId)
        .in("location_id", slice)
        .is("missing_on_google_at", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const row of rows) {
        reviews.push({
          id: row.id,
          locationId: row.location_id,
          stars: row.star_rating,
          createdAt: row.review_create_time,
          contentHash: row.content_fingerprint ?? "",
          overall: null,
          topics: [],
          issues: [],
          praise: [],
          excerpts: [],
        });
      }
      if (reviews.length > MAX_SUMMARY_REVIEWS) {
        throw new Error("This scope has more reviews than one summary pass can count");
      }
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  const ids = reviews.map((review) => review.id);
  for (let offset = 0; offset < ids.length; offset += 200) {
    const slice = ids.slice(offset, offset + 200);
    const { data, error } = await admin
      .from("grm_review_intelligence")
      .select("review_id, extraction")
      .eq("workspace_id", workspaceId)
      .eq("is_current", true)
      .eq("status", "ready")
      .eq("analysis_version", EXTRACT_ANALYSIS_VERSION)
      .in("review_id", slice);
    if (error) throw new Error(error.message);
    const byReview = new Map((data ?? []).map((row) => [row.review_id, asExtraction(row.extraction)]));
    for (const review of reviews) {
      const extracted = byReview.get(review.id);
      if (!extracted) continue;
      review.overall = extracted.overall;
      review.topics = extracted.topics;
      review.issues = extracted.issues;
      review.praise = extracted.praise;
      review.excerpts = extracted.excerpts;
      review.aspects = extracted.aspects;
      review.staffMentions = extracted.staffMentions;
      review.requests = extracted.requests;
      review.severe = extracted.severe;
    }
  }
  if (ids.length === 0) return reviews;
  try {
    const clusters = new Map<string, string[]>();
    let clusterError: string | null = null;
    for (let offset = 0; offset < ids.length; offset += 200) {
      const { data, error } = await admin
        .from("grm_cluster_members")
        .select("review_id, cluster_id")
        .eq("workspace_id", workspaceId)
        .in("review_id", ids.slice(offset, offset + 200));
      if (error) {
        clusterError = error.message;
        break;
      }
      for (const row of data ?? []) {
        const list = clusters.get(row.review_id) ?? [];
        list.push(row.cluster_id);
        clusters.set(row.review_id, list);
      }
    }
    if (!clusterError) {
      for (const review of reviews) review.clusterIds = clusters.get(review.id) ?? [];
    }
  } catch (error) {
    logger.warn("summaries.clusters_unavailable", { message: error instanceof Error ? error.message : "unavailable" });
  }
  return reviews;
}

async function findSummary(admin: Admin, scope: AuthorizedSummaryScope, window: SummaryWindow) {
  let query = admin
    .from("grm_scope_summaries")
    .select("id, status, source_hash, scope_retired_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("scope_type", scope.scopeType)
    .eq("scope_id", scope.scopeId)
    .eq("range_kind", window.kind)
    .eq("timezone", window.timezone)
    .eq("analysis_version", SUMMARY_ANALYSIS_VERSION)
    .eq("taxonomy_version", "taxonomy-v2")
    .eq("schema_version", "intelligence-schema-v1")
    .eq("prompt_version", SUMMARY_PROMPT_VERSION)
    .eq("membership_hash", scope.membershipHash);
  query =
    window.kind === "all" || !window.start || !window.end
      ? query.is("range_start", null).is("range_end", null)
      : query.eq("range_start", window.start).eq("range_end", window.end);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function openSummaryJobs(admin: Admin, workspaceId: string, sourceHash: string) {
  const { data, error } = await admin
    .from("grm_intelligence_jobs")
    .select("id, status, source_hash")
    .eq("workspace_id", workspaceId)
    .eq("operation", "build_summary")
    .eq("source_hash", sourceHash)
    .in("status", ["queued", "running"]);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function writeSummary(
  admin: Admin,
  scope: AuthorizedSummaryScope,
  window: SummaryWindow,
  document: SummaryDocument,
  existingId: string | null
): Promise<string> {
  const narrative = summaryNarrative(document);
  const now = new Date().toISOString();
  const payload = {
    workspace_id: scope.workspaceId,
    client_id: scope.clientId,
    scope_type: scope.scopeType,
    scope_id: scope.scopeId,
    group_id: scope.groupId,
    location_id: scope.locationId,
    placed_group_id: scope.placedGroupId,
    parent_group_id: scope.parentGroupId,
    scope_label: scope.label,
    range_kind: window.kind,
    range_start: window.start,
    range_end: window.end,
    range_label: window.label,
    timezone: window.timezone,
    analysis_version: SUMMARY_ANALYSIS_VERSION,
    taxonomy_version: document.taxonomyVersion,
    schema_version: document.schemaVersion,
    prompt_version: SUMMARY_PROMPT_VERSION,
    membership_basis: "current" as const,
    member_location_ids: scope.locationIds,
    membership_hash: scope.membershipHash,
    source_hash: document.sourceHash,
    source_review_count: document.coverage.reviewCount,
    summary: narrative,
    document: document as unknown as Json,
    status: "ready" as const,
    last_error: null,
    generated_at: now,
  };
  if (existingId) {
    const { data: prior } = await admin
      .from("grm_scope_summaries")
      .select("source_hash")
      .eq("id", existingId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    const { error } = await admin.from("grm_scope_summaries").update(payload).eq("id", existingId).eq("workspace_id", scope.workspaceId);
    if (error) throw new Error(error.message);
    if (prior && prior.source_hash !== document.sourceHash) {
      await admin
        .from("grm_insight_reports")
        .update({ status: "stale" })
        .eq("workspace_id", scope.workspaceId)
        .eq("summary_id", existingId)
        .eq("prompt_version", INSIGHT_PROMPT_VERSION)
        .eq("status", "ready");
    }
    return existingId;
  }
  const { data, error } = await admin.from("grm_scope_summaries").insert(payload).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function writeSnapshots(admin: Admin, workspaceId: string, summaryId: string, document: SummaryDocument): Promise<void> {
  const { data, error } = await admin
    .from("grm_metric_definitions")
    .select("id, metric_key")
    .is("workspace_id", null)
    .in("metric_key", ["review_count", "average_rating", "negative_share"]);
  if (error || !data) return;
  const values: Record<string, number | null> = {
    review_count: document.coverage.reviewCount,
    average_rating: document.metrics.averageRating,
    negative_share: document.metrics.negativeShare,
  };
  for (const definition of data) {
    const { error: upsertError } = await admin.from("grm_metric_snapshots").upsert(
      {
        workspace_id: workspaceId,
        summary_id: summaryId,
        definition_id: definition.id,
        value: values[definition.metric_key] ?? null,
        sample_size: document.metrics.ratingDenominator,
        inputs_hash: document.sourceHash,
      },
      { onConflict: "summary_id,definition_id" }
    );
    if (upsertError) logger.warn("summaries.snapshot_failed", { message: upsertError.message });
  }
  const stub = {
    workspace_id: workspaceId,
    summary_id: summaryId,
    prompt_version: SUMMARY_PROMPT_VERSION,
    model: "none",
    status: "ready" as const,
    findings: document.evidence as unknown as Json,
    recommendations: [] as Json,
    metrics: {
      reviewCount: document.coverage.reviewCount,
      averageRating: document.metrics.averageRating,
      negativeShare: document.metrics.negativeShare,
    } as Json,
    generated_at: new Date().toISOString(),
  };
  const { data: existingReport, error: readReportError } = await admin
    .from("grm_insight_reports")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("summary_id", summaryId)
    .eq("prompt_version", SUMMARY_PROMPT_VERSION)
    .limit(1)
    .maybeSingle();
  if (readReportError) {
    logger.warn("summaries.report_failed", { message: readReportError.message });
    return;
  }
  const { error: reportError } = existingReport
    ? await admin.from("grm_insight_reports").update(stub).eq("id", existingReport.id).eq("workspace_id", workspaceId)
    : await admin.from("grm_insight_reports").insert(stub);
  if (reportError) logger.warn("summaries.report_failed", { message: reportError.message });
}

/**
 * When the organisation summary store has data for this scope, its slice
 * is the source of truth for the counted fields. Evidence and cluster
 * fields stay with the built document. Any failure falls back silently.
 */
async function applyOrgProjection(
  admin: Admin,
  scope: AuthorizedSummaryScope,
  window: SummaryWindow,
  built: SummaryDocument
): Promise<SummaryDocument> {
  try {
    if (!scope.clientId) return built;
    const { data, error } = await admin
      .from("grm_org_summaries")
      .select("state")
      .eq("workspace_id", scope.workspaceId)
      .eq("client_id", scope.clientId)
      .maybeSingle();
    if (error || !data) return built;
    const raw = data.state as Partial<OrgSummaryState> | null;
    if (!raw || raw.version !== 1 || typeof raw.contributions !== "object" || typeof raw.days !== "object") return built;
    const projection = projectOrgSummary(
      { version: 1, clientId: scope.clientId, contributions: raw.contributions ?? {}, days: raw.days ?? {} },
      { locationIds: scope.locationIds, window }
    );
    if (!projection) return built;
    return {
      ...built,
      coverage: projection.coverage,
      metrics: projection.metrics,
      sentiment: projection.sentiment,
      topics: projection.topics,
      issues: projection.issues,
      praise: projection.praise,
      months: projection.months,
      locations: projection.locations,
      changes: projection.changes,
      sourceHash: projection.sourceHash,
    };
  } catch {
    return built;
  }
}

export async function saveScopedSummary(
  admin: Admin,
  scope: AuthorizedSummaryScope,
  window: SummaryWindow,
  reviews: readonly SummaryReview[],
  previousReviews: readonly SummaryReview[] = []
): Promise<SummaryResult> {
  const built = buildSummaryDocument({
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    locationIds: scope.locationIds,
    window,
    reviews,
    previousReviews,
  });
  const document = await applyOrgProjection(admin, scope, window, built);
  const identity = summaryIdentityFor(scope, window);
  const jobKey = summaryIdentityHash(identity);
  const existing = await findSummary(admin, scope, window);
  if (
    existing &&
    summaryReuse({ status: existing.status, sourceHash: existing.source_hash, scopeRetiredAt: existing.scope_retired_at }, document.sourceHash) === "reuse"
  ) {
    return {
      status: "ready",
      reused: true,
      summaryId: existing.id,
      document,
      narrative: summaryNarrative(document),
    };
  }
  const open = await openSummaryJobs(admin, scope.workspaceId, jobKey);
  if (beginSummaryJob(open.map((job) => ({ sourceHash: job.source_hash ?? "", status: job.status })), jobKey) === "reuse") {
    return { status: "processing", reused: true, summaryId: existing?.id ?? null, document: null, narrative: null };
  }
  const { data: job, error: jobError } = await admin
    .from("grm_intelligence_jobs")
    .insert({
      workspace_id: scope.workspaceId,
      operation: "build_summary",
      status: "running",
      summary_id: existing?.id ?? null,
      source_hash: jobKey,
      analysis_version: SUMMARY_ANALYSIS_VERSION,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobError) {
    if (jobError.code === "23505") {
      return { status: "processing", reused: true, summaryId: existing?.id ?? null, document: null, narrative: null };
    }
    throw new Error(jobError.message);
  }
  try {
    const summaryId = await writeSummary(admin, scope, window, document, existing?.id ?? null);
    await writeSnapshots(admin, scope.workspaceId, summaryId, document);
    const { error } = await admin
      .from("grm_intelligence_jobs")
      .update({ status: "succeeded", summary_id: summaryId, finished_at: new Date().toISOString(), last_error: null, error_class: null })
      .eq("id", job.id)
      .eq("status", "running");
    if (error) throw new Error(error.message);
    return { status: "ready", reused: false, summaryId, document, narrative: summaryNarrative(document) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "summary failed";
    await admin
      .from("grm_intelligence_jobs")
      .update({ status: "failed", error_class: "unknown", last_error: message.slice(0, 500), finished_at: new Date().toISOString() })
      .eq("id", job.id);
    if (existing?.id) {
      await admin
        .from("grm_scope_summaries")
        .update({ status: "failed", last_error: message.slice(0, 500) })
        .eq("id", existing.id)
        .eq("workspace_id", scope.workspaceId);
    }
    throw error;
  }
}

export async function getScopedSummary(
  admin: Admin,
  input: {
    userId: string;
    workspaceId: string;
    clientId?: string | null;
    groupId?: string | null;
    locationId?: string | null;
    range: DateRange;
    timezone?: string;
    now?: Date;
  }
): Promise<SummaryResult> {
  const catalog = await loadScopeCatalog(input.userId, input.workspaceId);
  if (!catalog) throw new Error("This scope is not available to the signed-in member");
  const request: ScopeRequest = readScopeRequest({
    client: input.clientId,
    group: input.groupId,
    location: input.locationId,
  });
  const scope = authorizeSummaryScope(catalog, request);
  const timezone = input.timezone ? assertSummaryTimezone(input.timezone) : SUMMARY_DEFAULT_TIMEZONE;
  const window = summaryWindow(input.range, timezone, input.now ?? new Date());
  const reviews = await loadSummaryReviews(admin, scope.workspaceId, scope.locationIds);
  return saveScopedSummary(admin, scope, window, reviews, reviews);
}

export async function invalidateLocationSummaries(
  supabase: Admin,
  workspaceId: string,
  locationId: string,
  times?: { createdAt: string | null; previousCreatedAt?: string | null }
): Promise<void> {
  const { data, error } = await supabase
    .from("grm_scope_summaries")
    .select("id, location_id, member_location_ids, range_kind, range_start, range_end, membership_hash, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "ready")
    .or(`location_id.eq.${locationId},member_location_ids.cs.{${locationId}}`);
  if (error || !data || data.length === 0) return;
  const refs: StoredSummaryRef[] = data.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    memberLocationIds: row.member_location_ids ?? [],
    rangeKind: row.range_kind === "all" ? "all" : "bounded",
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    membershipHash: row.membership_hash,
    status: row.status,
  }));
  const ids = times
    ? refs.filter((summary) => reviewTouchesSummary(summary, { locationId, ...times })).map((summary) => summary.id)
    : refs.map((summary) => summary.id);
  if (ids.length === 0) return;
  await supabase.from("grm_scope_summaries").update({ status: "stale" }).in("id", ids).eq("status", "ready");
  await supabase
    .from("grm_insight_reports")
    .update({ status: "stale" })
    .eq("workspace_id", workspaceId)
    .in("summary_id", ids)
    .eq("status", "ready");
  for (const summaryId of ids.slice(0, ENQUEUE_LIMIT)) {
    const { error: enqueueError } = await supabase.from("grm_intelligence_jobs").insert({
      workspace_id: workspaceId,
      operation: "build_summary",
      status: "queued",
      summary_id: summaryId,
      source_hash: summaryId,
      analysis_version: SUMMARY_ANALYSIS_VERSION,
    });
    if (enqueueError && enqueueError.code !== "23505") {
      logger.warn("summaries.enqueue_failed", { message: enqueueError.message });
    }
  }
}

export async function noteMembershipChange(admin: Admin, workspaceId: string, locationIds: readonly string[]): Promise<void> {
  try {
    for (const locationId of locationIds) {
      await invalidateLocationSummaries(admin, workspaceId, locationId);
    }
  } catch (error) {
    logger.error("summaries.membership_failed", { message: error instanceof Error ? error.message : "membership" });
  }
}

async function currentMemberIds(
  admin: Admin,
  workspaceId: string,
  summary: { client_id: string; scope_type: string; scope_id: string; location_id: string | null }
): Promise<string[]> {
  if (summary.scope_type === "location") return summary.location_id ? [summary.location_id] : [];
  const { data: locations, error } = await admin
    .from("grm_google_locations")
    .select("id, group_id")
    .eq("workspace_id", workspaceId)
    .eq("client_id", summary.client_id);
  if (error) throw new Error(error.message);
  if (summary.scope_type === "organisation") return (locations ?? []).map((location) => location.id);
  const { data: groups, error: groupError } = await admin.from("grm_groups").select("id, parent_id").eq("workspace_id", workspaceId);
  if (groupError) throw new Error(groupError.message);
  const nodes = (groups ?? []).map((group) => ({ id: group.id, parentId: group.parent_id }));
  return (locations ?? [])
    .filter((location) => locationInGroup(location.group_id, summary.scope_id, nodes))
    .map((location) => location.id);
}

export async function processSummaryJobs(admin: Admin, workspaceId: string): Promise<number> {
  const { data, error } = await admin
    .from("grm_intelligence_jobs")
    .select("id, summary_id, source_hash")
    .eq("workspace_id", workspaceId)
    .eq("operation", "build_summary")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(REFRESH_BATCH);
  if (error) throw new Error(error.message);
  let processed = 0;
  for (const job of data ?? []) {
    const { data: claimed, error: claimError } = await admin
      .from("grm_intelligence_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id, summary_id")
      .maybeSingle();
    if (claimError || !claimed?.summary_id) continue;
    const { data: summary, error: summaryError } = await admin
      .from("grm_scope_summaries")
      .select("id, client_id, scope_type, scope_id, group_id, location_id, placed_group_id, parent_group_id, scope_label, range_kind, range_start, range_end, range_label, timezone, membership_hash, member_location_ids")
      .eq("id", claimed.summary_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (summaryError || !summary) {
      await admin.from("grm_intelligence_jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), last_error: "Summary row is gone" }).eq("id", job.id);
      continue;
    }
    const liveIds = await currentMemberIds(admin, workspaceId, summary);
    if (membershipHash(liveIds) !== summary.membership_hash) {
      await admin
        .from("grm_scope_summaries")
        .update({ status: "stale", last_error: "Membership changed. The next request stores a new summary." })
        .eq("id", summary.id)
        .eq("workspace_id", workspaceId);
      await admin
        .from("grm_insight_reports")
        .update({ status: "stale" })
        .eq("workspace_id", workspaceId)
        .eq("summary_id", summary.id)
        .eq("status", "ready");
      await admin
        .from("grm_intelligence_jobs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          last_error: "Membership changed. The next request stores a new summary.",
        })
        .eq("id", job.id);
      processed += 1;
      continue;
    }
    const scope: AuthorizedSummaryScope = {
      workspaceId,
      clientId: summary.client_id,
      scopeType: summary.scope_type as AuthorizedSummaryScope["scopeType"],
      scopeId: summary.scope_id,
      groupId: summary.group_id,
      locationId: summary.location_id,
      placedGroupId: summary.placed_group_id,
      parentGroupId: summary.parent_group_id,
      label: summary.scope_label,
      locationIds: summary.member_location_ids ?? [],
      membershipHash: summary.membership_hash,
    };
    const window: SummaryWindow = {
      kind: summary.range_kind === "all" ? "all" : "bounded",
      start: summary.range_start,
      end: summary.range_end,
      timezone: summary.timezone as SummaryWindow["timezone"],
      label: summary.range_label,
      comparison: null,
    };
    const reviews = await loadSummaryReviews(admin, workspaceId, scope.locationIds);
    const document = buildSummaryDocument({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      locationIds: scope.locationIds,
      window,
      reviews,
    });
    await writeSummary(admin, scope, window, document, summary.id);
    await writeSnapshots(admin, workspaceId, summary.id, document);
    await admin
      .from("grm_intelligence_jobs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), last_error: null, error_class: null })
      .eq("id", job.id)
      .eq("status", "running");
    processed += 1;
  }
  return processed;
}
