import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { groupIdsInScope } from "@/lib/hierarchy";
import { readableReviewText } from "@/lib/review-text";
import {
  GEMINI_FAST_MODEL_ID,
  GEMINI_THINKING_LOW,
  GEMINI_THINKING_MINIMAL,
  extractGeminiText,
  geminiGenerateUrl,
} from "@/lib/gemini";
import { AuditService } from "./audit";
import {
  emptyAnalysis,
  parseLocationInsightPayload,
  type ProfileAnalysis,
  type SentimentLabel,
} from "./location-insights";
import type { Json } from "@/lib/types/supabase";
import { insightLensFingerprint, insightLensPromptBlock, orgContextPromptBlock } from "@/lib/ai-config";
import { ensureActiveAiConfig, loadResolvedInsightLens } from "@/lib/services/ai-config";
import {
  claimAiGenerationJob,
  completeAiGenerationJob,
  createAiGenerationJob,
  failAiGenerationJob,
} from "@/lib/services/ai-generation-jobs";
import { summaryBriefBlock, summaryEvidenceIds, tryAllTimeSummaryBrief } from "@/lib/services/summary-brief";
import { usageFromResponse } from "@/lib/services/intelligence-extract";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";

const MODEL_ID = GEMINI_FAST_MODEL_ID;
export const SCOPE_INSIGHT_PROMPT_VERSION = "scope-insight-v2.0";
const REQUEST_TIMEOUT_MS = 55_000;
const MAX_REVIEW_SAMPLES = 60;
const PREVIEW_REVIEW_SAMPLES = 20;

export type ScopeInsightKind = "client" | "group";

export interface ScopeInsight {
  /** Set when saving runs in the background; the brief is already displayable. */
  jobId?: string;
  scopeKind: ScopeInsightKind;
  scopeId: string;
  title: string;
  summary: string;
  sentimentLabel: SentimentLabel;
  themes: string[];
  highlights: string[];
  risks: string[];
  analysis: ProfileAnalysis;
  reviewCount: number;
  locationCount: number;
  avgRating: number | null;
  sourceHash: string;
  generatedAt: string;
  stale: boolean;
}

interface ScopedLocation {
  id: string;
  title: string;
  groupId: string | null;
}

interface TaggedReview {
  id: string;
  locationId: string;
  locationTitle: string;
  star_rating: number;
  comment: string | null;
  review_create_time: string;
}

function hashSource(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

function hasRichAnalysis(analysis: ProfileAnalysis): boolean {
  return (
    analysis.suggestedFeatures.length > 0 ||
    analysis.branding.strengths.length > 0 ||
    analysis.customerFeedback.loves.length > 0 ||
    analysis.staff.praise.length > 0 ||
    analysis.staff.issues.length > 0
  );
}

function asAnalysis(value: unknown): ProfileAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyAnalysis();
  }
  try {
    const raw = value as Record<string, unknown>;
    const storedIds = Array.isArray(raw.evidenceReviewIds)
      ? raw.evidenceReviewIds
      : Array.isArray(raw.evidence_review_ids)
        ? raw.evidence_review_ids
        : [];
    const allowed = storedIds.filter((id): id is string => typeof id === "string");
    return parseLocationInsightPayload(
      JSON.stringify({ summary: "cached", ...raw, sentiment: "neutral" }),
      allowed
    ).analysis;
  } catch {
    return emptyAnalysis();
  }
}

function buildFingerprint(
  kind: ScopeInsightKind,
  scopeId: string,
  locationIds: string[],
  reviews: TaggedReview[],
  avgRating: number | null,
  lensFingerprint = ""
): string {
  const parts = [
    kind,
    scopeId,
    locationIds.slice().sort().join(","),
    String(reviews.length),
    avgRating?.toFixed(2) ?? "na",
    lensFingerprint,
    ...reviews.map(
      (r) =>
        `${r.locationId}|${r.review_create_time}|${r.star_rating}|${(r.comment ?? "").slice(0, 60)}`
    ),
  ];
  return hashSource(parts.join("\n"));
}

function heuristicScope(
  title: string,
  locationCount: number,
  reviews: TaggedReview[],
  avgRating: number | null
): Omit<ScopeInsight, "scopeKind" | "scopeId" | "title" | "generatedAt" | "stale" | "sourceHash"> {
  const negative = reviews.filter((r) => r.star_rating <= 2);
  const positive = reviews.filter((r) => r.star_rating >= 4);
  const sentiment: SentimentLabel =
    avgRating == null
      ? "neutral"
      : avgRating >= 4.2
        ? "positive"
        : avgRating >= 3.2
          ? "mixed"
          : avgRating >= 1
            ? "negative"
            : "neutral";

  const summary =
    reviews.length === 0
      ? `${title} has ${locationCount} location${locationCount === 1 ? "" : "s"} but no synced reviews yet.`
      : `${title} covers ${locationCount} location${locationCount === 1 ? "" : "s"} with ${reviews.length} recent review${reviews.length === 1 ? "" : "s"}` +
        (avgRating != null ? ` averaging ${avgRating.toFixed(1)}★` : "") +
        `. ${positive.length} positive, ${negative.length} need attention.`;

  return {
    summary,
    sentimentLabel: sentiment,
    themes: [],
    highlights: positive
      .filter((r) => r.comment)
      .slice(0, 3)
      .map((r) => `${r.locationTitle}: ${r.comment!.trim().slice(0, 120)}`),
    risks: negative
      .filter((r) => r.comment)
      .slice(0, 3)
      .map((r) => `${r.locationTitle}: ${r.comment!.trim().slice(0, 120)}`),
    analysis: emptyAnalysis(),
    reviewCount: reviews.length,
    locationCount,
    avgRating,
  };
}

export class ScopeInsightService {
  static async resolveLocations(
    workspaceId: string,
    kind: ScopeInsightKind,
    scopeId: string
  ): Promise<{ title: string; locations: ScopedLocation[] }> {
    const admin = createAdminClient();

    if (kind === "client") {
      const [{ data: client }, { data: locations }] = await Promise.all([
        admin
          .from("grm_clients")
          .select("id, name")
          .eq("id", scopeId)
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
        admin
          .from("grm_google_locations")
          .select("id, location_title, group_id")
          .eq("workspace_id", workspaceId)
          .eq("client_id", scopeId)
          .eq("is_active", true),
      ]);
      if (!client) throw new AppError("Client not found", "NOT_FOUND", 404);
      return {
        title: client.name,
        locations: (locations ?? []).map((row) => ({
          id: row.id,
          title: row.location_title || "Location",
          groupId: row.group_id,
        })),
      };
    }

    const { data: group } = await admin
      .from("grm_groups")
      .select("id, name, client_id, parent_id")
      .eq("id", scopeId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!group) throw new AppError("Group not found", "NOT_FOUND", 404);

    let siblingQuery = admin
      .from("grm_groups")
      .select("id, parent_id")
      .eq("workspace_id", workspaceId);
    if (group.client_id) siblingQuery = siblingQuery.eq("client_id", group.client_id);
    const { data: siblingGroups } = await siblingQuery;
    const scopeGroupIds = groupIdsInScope(
      group.id,
      (siblingGroups ?? []).map((row) => ({ id: row.id, parentId: row.parent_id }))
    );
    if (scopeGroupIds.length === 0) {
      return { title: group.name, locations: [] };
    }

    const { data: locations } = await admin
      .from("grm_google_locations")
      .select("id, location_title, group_id")
      .eq("workspace_id", workspaceId)
      .in("group_id", scopeGroupIds)
      .eq("is_active", true);

    return {
      title: group.name,
      locations: (locations ?? []).map((row) => ({
        id: row.id,
        title: row.location_title || "Location",
        groupId: row.group_id,
      })),
    };
  }

  static async buildScopeStats(
    workspaceId: string,
    kind: ScopeInsightKind,
    scopeId: string
  ): Promise<{
    title: string;
    locations: ScopedLocation[];
    reviews: TaggedReview[];
    avgRating: number | null;
    fingerprint: string;
    heuristic: ReturnType<typeof heuristicScope>;
  }> {
    const { title, locations } = await this.resolveLocations(workspaceId, kind, scopeId);
    const locationIds = locations.map((location) => location.id);
    const titleById = new Map(locations.map((location) => [location.id, location.title]));

    if (locationIds.length === 0) {
      const fingerprint = buildFingerprint(kind, scopeId, [], [], null);
      return {
        title,
        locations,
        reviews: [],
        avgRating: null,
        fingerprint,
        heuristic: heuristicScope(title, 0, [], null),
      };
    }

    const admin = createAdminClient();
    const { data: reviews } = await admin
      .from("grm_reviews")
      .select("id, location_id, star_rating, comment, review_create_time")
      .eq("workspace_id", workspaceId)
      .in("location_id", locationIds)
      .order("review_create_time", { ascending: false })
      .limit(MAX_REVIEW_SAMPLES);

    const tagged: TaggedReview[] = (reviews ?? []).map((row) => ({
      id: row.id,
      locationId: row.location_id,
      locationTitle: titleById.get(row.location_id) ?? "Location",
      star_rating: row.star_rating,
      comment: row.comment,
      review_create_time: row.review_create_time,
    }));

    const avgRating =
      tagged.length > 0
        ? tagged.reduce((sum, row) => sum + row.star_rating, 0) / tagged.length
        : null;
    const fingerprint = buildFingerprint(kind, scopeId, locationIds, tagged, avgRating);

    return {
      title,
      locations,
      reviews: tagged,
      avgRating,
      fingerprint,
      heuristic: heuristicScope(title, locations.length, tagged, avgRating),
    };
  }

  static async getCached(
    workspaceId: string,
    kind: ScopeInsightKind,
    scopeId: string,
    fingerprint: string,
    title: string
  ): Promise<ScopeInsight | null> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_scope_insights")
      .select(
        `scope_kind, scope_id, summary, sentiment_label, themes, highlights, risks, analysis,
         review_count, location_count, avg_rating, source_hash, generated_at, prompt_version`
      )
      .eq("workspace_id", workspaceId)
      .eq("scope_kind", kind)
      .eq("scope_id", scopeId)
      .maybeSingle();

    if (error) {
      if (/relation .* does not exist/i.test(error.message) || /grm_scope_insights/i.test(error.message)) {
        return null;
      }
      throw new AppError("Could not load scope insight", "DB_ERROR", 500);
    }
    if (!data) return null;

    const analysis = asAnalysis(data.analysis);
    const stale =
      fingerprint !== data.source_hash ||
      data.prompt_version !== SCOPE_INSIGHT_PROMPT_VERSION ||
      !hasRichAnalysis(analysis);

    return {
      scopeKind: data.scope_kind as ScopeInsightKind,
      scopeId: data.scope_id,
      title,
      summary: data.summary,
      sentimentLabel: data.sentiment_label as SentimentLabel,
      themes: Array.isArray(data.themes) ? (data.themes as string[]) : [],
      highlights: Array.isArray(data.highlights) ? (data.highlights as string[]) : [],
      risks: Array.isArray(data.risks) ? (data.risks as string[]) : [],
      analysis,
      reviewCount: data.review_count,
      locationCount: data.location_count,
      avgRating: data.avg_rating != null ? Number(data.avg_rating) : null,
      sourceHash: data.source_hash,
      generatedAt: data.generated_at,
      stale,
    };
  }

  static async getView(
    workspaceId: string,
    kind: ScopeInsightKind,
    scopeId: string
  ): Promise<{ insight: ScopeInsight | null; heuristicSummary: string; title: string; locationCount: number; reviewCount: number; avgRating: number | null }> {
    const stats = await this.buildScopeStats(workspaceId, kind, scopeId);
    const admin = createAdminClient();
    let clientId: string | null = kind === "client" ? scopeId : null;
    if (kind === "group") {
      const { data: group } = await admin
        .from("grm_groups")
        .select("client_id")
        .eq("id", scopeId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      clientId = group?.client_id ?? null;
    }
    const { lens } = await loadResolvedInsightLens({ workspaceId, clientId });
    const fingerprint = buildFingerprint(
      kind,
      scopeId,
      stats.locations.map((location) => location.id),
      stats.reviews,
      stats.avgRating,
      insightLensFingerprint(lens)
    );
    const cached = await this.getCached(workspaceId, kind, scopeId, fingerprint, stats.title);
    return {
      insight: cached,
      heuristicSummary: stats.heuristic.summary,
      title: stats.title,
      locationCount: stats.locations.length,
      reviewCount: stats.reviews.length,
      avgRating: stats.avgRating,
    };
  }

  static async generate(
    workspaceId: string,
    kind: ScopeInsightKind,
    scopeId: string,
    userId: string,
    options: { force?: boolean; preview?: boolean; deferPersistence?: boolean } = {}
  ): Promise<ScopeInsight> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AppError("Gemini API key not configured", "CONFIG_ERROR", 500);
    }

    const stats = await this.buildScopeStats(workspaceId, kind, scopeId);
    const admin = createAdminClient();
    let clientId: string | null = kind === "client" ? scopeId : null;
    if (kind === "group") {
      const { data: group } = await admin
        .from("grm_groups")
        .select("client_id")
        .eq("id", scopeId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      clientId = group?.client_id ?? null;
    }
    const [{ lens, notes }, config] = await Promise.all([
      loadResolvedInsightLens({ workspaceId, clientId }),
      ensureActiveAiConfig(workspaceId),
    ]);
    const fingerprint = buildFingerprint(
      kind,
      scopeId,
      stats.locations.map((location) => location.id),
      stats.reviews,
      stats.avgRating,
      insightLensFingerprint(lens)
    );

    if (!options.force && !options.preview) {
      const cached = await this.getCached(workspaceId, kind, scopeId, fingerprint, stats.title);
      if (cached && !cached.stale) return cached;
    }

    // Preferred source: the stored all-time summary for this scope. The
    // brief is then written from counted topics and stored evidence quotes,
    // never from a fresh read of raw reviews.
    const summaryDocument = await tryAllTimeSummaryBrief(
      admin,
      workspaceId,
      kind === "client" ? "organisation" : "group",
      scopeId,
      stats.locations.map((location) => location.id)
    );
    const useSummary = summaryDocument !== null && summaryDocument.coverage.reviewCount > 0;

    if (stats.reviews.length === 0 && !useSummary) {
      const empty: ScopeInsight = {
        scopeKind: kind,
        scopeId,
        title: stats.title,
        ...stats.heuristic,
        sourceHash: fingerprint,
        generatedAt: new Date().toISOString(),
        stale: false,
      };
      if (!options.preview) await this.upsert(workspaceId, userId, empty);
      return empty;
    }

    const promptReviews = options.preview
      ? stats.reviews.slice(0, PREVIEW_REVIEW_SAMPLES)
      : stats.reviews;
    const reviewBlock = useSummary
      ? summaryBriefBlock(summaryDocument, new Map(stats.locations.map((location) => [location.id, location.title])))
      : promptReviews
          .map(
            (r, i) =>
              `${i + 1}. id=${r.id} · [${r.locationTitle}] ${r.star_rating}/5 — ${(readableReviewText(r.comment) ?? "(rating only)").slice(0, options.preview ? 160 : 350)}`
          )
          .join("\n");
    const sampleIds = useSummary ? summaryEvidenceIds(summaryDocument) : promptReviews.map((r) => r.id);

    const locationList = stats.locations
      .slice(0, 40)
      .map((location) => `- ${location.title}`)
      .join("\n");

    const scopeLabel = kind === "client" ? "organisation / brand" : "location group";
    const lensBlock = insightLensPromptBlock(lens, notes);
    const orgBlock = orgContextPromptBlock(config.snapshot.org);

    const prompt = `You are a reputation, branding, and customer-experience analyst for a multi-location Google Business Profile ${scopeLabel}.
Write a self-explanatory leadership brief. Prefer the operator's insight lens when those themes appear in the reviews.
${orgBlock}${lensBlock}
${scopeLabel === "organisation / brand" ? "Brand" : "Group"}: "${stats.title}"
Locations in scope (${stats.locations.length}):
${locationList || "- (none)"}
${useSummary ? `Reviews counted: ${summaryDocument.coverage.reviewCount} (all time, from the stored summary below)` : `Reviews in this sample: ${promptReviews.length} (newest across all locations)`}
Average rating${useSummary ? "" : " in sample"}: ${(useSummary ? summaryDocument.metrics.averageRating : stats.avgRating)?.toFixed(2) ?? "n/a"}

${useSummary ? "STORED SUMMARY (base every claim on these counts and quotes; never recount or invent numbers):" : "REVIEWS (each line starts with the shop name):"}
${reviewBlock}

Return ONLY valid JSON (no markdown) with this exact shape:
{
  "summary": "3-5 sentence briefing for leadership: overall reputation across locations, what the brand/group is known for, where shops differ, and the one priority to fix first",
  "sentiment": "positive" | "mixed" | "negative" | "neutral",
  "themes": ["up to 6 recurring themes across locations"],
  "highlights": ["up to 4 praise patterns — name a shop when evidence is local"],
  "risks": ["up to 4 reputation risks — name a shop when evidence is local"],
  "branding": {
    "voice": "how customers describe the brand personality across shops",
    "strengths": ["up to 4 brand strengths"],
    "gaps": ["up to 4 brand or listing gaps that show up in more than one place"]
  },
  "staff": {
    "summary": "how customers talk about people across the network",
    "praise": ["staff praise patterns"],
    "issues": ["staff-related complaints that repeat"]
  },
  "customerFeedback": {
    "loves": ["what customers keep coming back for"],
    "friction": ["pain points that appear across shops"],
    "requests": ["things customers ask for"]
  },
  "operations": {
    "summary": "consistency across locations: hours, queue, cleanliness, facilities",
    "notes": ["specific operational notes; call out outlier shops"]
  },
  "suggestedFeatures": [
    {
      "title": "short action for the brand or group",
      "why": "what it would improve across shops",
      "basedOn": "which review pattern justifies it",
      "effort": "quick" | "medium" | "project"
    }
  ],
  "replyPlaybook": {
    "tone": "how replies should sound for this brand/group",
    "do": ["up to 4 reply habits"],
    "avoid": ["up to 4 things not to say"]
  },
  "evidenceReviewIds": ["up to 8 review id values from the sample above that ground your summary"]
}

Rules:
- Base every claim on the reviews. If evidence is thin, say so. Never invent staff names, services, or policies.
- When the insight lens lists watch themes or focus questions, answer those first if the reviews support them.
- evidenceReviewIds must be copied exactly from the id= values in the sample. Never invent ids.
- Prefer patterns that show up at more than one location; when one shop is an outlier, name it.
- suggestedFeatures should help the whole brand/group, not only one storefront, unless a single shop is clearly dragging reputation.
- Prefer 4-6 suggestedFeatures.
- Do not mention that you are an AI. The lens is saved instructions, not model training.`;

    if ((await getAiBudget(admin, workspaceId)).exceeded) {
      const fallback: ScopeInsight = {
        scopeKind: kind,
        scopeId,
        title: stats.title,
        ...stats.heuristic,
        sourceHash: fingerprint,
        generatedAt: new Date().toISOString(),
        stale: false,
      };
      if (!options.preview) await this.upsert(workspaceId, userId, fallback);
      return fallback;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let parsed: ReturnType<typeof parseLocationInsightPayload>;
    try {
      const response = await fetch(
        geminiGenerateUrl(apiKey, options.preview ? GEMINI_FAST_MODEL_ID : MODEL_ID),
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: options.preview ? 3072 : 8192,
            topP: 0.9,
            responseMimeType: "application/json",
            thinkingConfig: options.preview ? GEMINI_THINKING_MINIMAL : GEMINI_THINKING_LOW,
          },
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const body = await response.text();
        logger.error("scope_insight.gemini_failed", {
          status: response.status,
          body: body.slice(0, 200),
        });
        if (options.preview) {
          throw new AppError("Quick preview unavailable", "AI_UNAVAILABLE", 502);
        }
        const fallback: ScopeInsight = {
          scopeKind: kind,
          scopeId,
          title: stats.title,
          ...stats.heuristic,
          sourceHash: fingerprint,
          generatedAt: new Date().toISOString(),
          stale: false,
          summary: `${stats.heuristic.summary} (AI unavailable — showing automatic summary.)`,
        };
        await this.upsert(workspaceId, userId, fallback);
        return fallback;
      }

      const data = await response.json();
      const usage = usageFromResponse(data);
      await recordAiUsage(admin, {
        workspaceId,
        operation: "insight_brief",
        model: MODEL_ID,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      const { text: rawText, finishReason } = extractGeminiText(data);
      if (finishReason === "MAX_TOKENS") {
        throw new AppError("AI insight was cut off. Please try again.", "AI_INVALID_RESPONSE", 502);
      }
      if (!rawText) {
        throw new AppError("Empty AI insight response", "AI_INVALID_RESPONSE", 502);
      }
      parsed = parseLocationInsightPayload(rawText, sampleIds);
      if (!parsed.summary) {
        throw new AppError("Invalid AI insight JSON", "AI_INVALID_RESPONSE", 502);
      }
      if (!parsed.analysis.evidenceReviewIds.length) {
        parsed.analysis.evidenceReviewIds = sampleIds.slice(0, 5);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new AppError("AI insight timed out", "AI_TIMEOUT", 504);
      }
      logger.error("scope_insight.generate_failed", {
        workspaceId,
        scopeKind: kind,
        scopeId,
        message: error instanceof Error ? error.message : "Unknown",
      });
      if (options.preview) {
        throw new AppError("Quick preview unavailable", "AI_UNAVAILABLE", 502);
      }
      const fallback: ScopeInsight = {
        scopeKind: kind,
        scopeId,
        title: stats.title,
        ...stats.heuristic,
        sourceHash: fingerprint,
        generatedAt: new Date().toISOString(),
        stale: false,
      };
      await this.upsert(workspaceId, userId, fallback);
      return fallback;
    } finally {
      clearTimeout(timeout);
    }

    const insight: ScopeInsight = {
      scopeKind: kind,
      scopeId,
      title: stats.title,
      summary: parsed.summary,
      sentimentLabel: parsed.sentiment,
      themes: parsed.themes,
      highlights: parsed.highlights,
      risks: parsed.risks,
      analysis: parsed.analysis,
      reviewCount: useSummary ? summaryDocument.coverage.reviewCount : promptReviews.length,
      locationCount: stats.locations.length,
      avgRating: useSummary ? summaryDocument.metrics.averageRating : stats.avgRating,
      sourceHash: fingerprint,
      generatedAt: new Date().toISOString(),
      stale: false,
    };

    if (options.preview) return insight;

    if (options.deferPersistence) {
      const jobId = await createAiGenerationJob({
        workspaceId,
        userId,
        kind: "scope_insight",
        scopeKind: kind,
        scopeId,
        model: MODEL_ID,
        payload: insight as unknown as Record<string, unknown>,
      });
      if (jobId) return { ...insight, jobId };
    }

    await this.upsert(workspaceId, userId, insight);
    await AuditService.log({
      workspaceId,
      userId,
      action: "scope_insight.generated",
      entityType: "grm_scope_insights",
      entityId: scopeId,
      metadata: {
        model: MODEL_ID,
        promptVersion: SCOPE_INSIGHT_PROMPT_VERSION,
        scopeKind: kind,
        reviewCount: insight.reviewCount,
        locationCount: insight.locationCount,
      },
    });

    return insight;
  }

  /** Background persister for a deferred scope insight job. Safe to retry. */
  static async persistGenerationJob(jobId: string): Promise<void> {
    const job = await claimAiGenerationJob(jobId);
    if (!job || job.kind !== "scope_insight") return;
    try {
      const insight = job.payload as unknown as ScopeInsight;
      await this.upsert(job.workspace_id, job.user_id, insight);
      await AuditService.log({
        workspaceId: job.workspace_id,
        userId: job.user_id,
        action: "scope_insight.generated",
        entityType: "grm_scope_insights",
        entityId: insight.scopeId,
        metadata: {
          model: job.model,
          promptVersion: SCOPE_INSIGHT_PROMPT_VERSION,
          scopeKind: insight.scopeKind,
          reviewCount: insight.reviewCount,
          locationCount: insight.locationCount,
        },
      });
      await completeAiGenerationJob(jobId, {});
    } catch (error) {
      await failAiGenerationJob(jobId, job.attempts + 1, error);
    }
  }

  private static async upsert(
    workspaceId: string,
    userId: string,
    insight: ScopeInsight
  ): Promise<void> {
    const admin = createAdminClient();
    const row = {
      workspace_id: workspaceId,
      scope_kind: insight.scopeKind,
      scope_id: insight.scopeId,
      summary: insight.summary,
      sentiment_label: insight.sentimentLabel,
      themes: insight.themes,
      highlights: insight.highlights,
      risks: insight.risks,
      analysis: insight.analysis as unknown as Json,
      review_count: insight.reviewCount,
      location_count: insight.locationCount,
      avg_rating: insight.avgRating,
      source_hash: insight.sourceHash,
      ai_model: MODEL_ID,
      prompt_version: SCOPE_INSIGHT_PROMPT_VERSION,
      generated_at: insight.generatedAt,
      generated_by: userId,
    };

    const { error } = await admin
      .from("grm_scope_insights")
      .upsert(row, { onConflict: "workspace_id,scope_kind,scope_id" });

    if (error) {
      logger.error("scope_insight.upsert_failed", { dbError: error.message });
      throw new AppError(
        /relation .* does not exist/i.test(error.message)
          ? "Scope insights are not installed on this database yet."
          : "Failed to store scope insight",
        "DB_ERROR",
        500
      );
    }
  }
}
