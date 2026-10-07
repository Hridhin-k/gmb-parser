import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AuditService } from "./audit";
import {
  GEMINI_MODEL_ID,
  GEMINI_THINKING_LOW,
  extractGeminiText,
  geminiGenerateUrl,
} from "@/lib/gemini";
import { readableReviewText } from "@/lib/review-text";
import type { Json } from "@/lib/types/supabase";

const MODEL_ID = GEMINI_MODEL_ID;
export const INSIGHT_PROMPT_VERSION = "insight-v2.0";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_REVIEW_SAMPLES = 50;

export type SentimentLabel = "positive" | "mixed" | "negative" | "neutral";
export type FeatureEffort = "quick" | "medium" | "project";

export interface SuggestedFeature {
  title: string;
  why: string;
  basedOn: string;
  effort: FeatureEffort;
}

export interface ProfileAnalysis {
  branding: { voice: string; strengths: string[]; gaps: string[] };
  staff: { summary: string; praise: string[]; issues: string[] };
  customerFeedback: { loves: string[]; friction: string[]; requests: string[] };
  operations: { summary: string; notes: string[] };
  suggestedFeatures: SuggestedFeature[];
  replyPlaybook: { tone: string; do: string[]; avoid: string[] };
}

export interface LocationInsight {
  locationId: string;
  summary: string;
  sentimentLabel: SentimentLabel;
  themes: string[];
  highlights: string[];
  risks: string[];
  analysis: ProfileAnalysis;
  reviewCount: number;
  avgRating: number | null;
  sourceHash: string;
  generatedAt: string;
  stale: boolean;
}

interface ReviewSample {
  star_rating: number;
  comment: string | null;
  review_create_time: string;
}

function hashSource(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

function buildSourceFingerprint(
  locationId: string,
  reviews: ReviewSample[],
  avgRating: number | null
): string {
  const parts = [
    locationId,
    String(reviews.length),
    avgRating?.toFixed(2) ?? "na",
    ...reviews.map(
      (r) =>
        `${r.review_create_time}|${r.star_rating}|${(r.comment ?? "").slice(0, 80)}`
    ),
  ];
  return hashSource(parts.join("\n"));
}

function strings(value: unknown, max = 6, len = 220): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim().slice(0, len))
    .slice(0, max);
}

function text(value: unknown, max = 400): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function emptyAnalysis(): ProfileAnalysis {
  return {
    branding: { voice: "", strengths: [], gaps: [] },
    staff: { summary: "", praise: [], issues: [] },
    customerFeedback: { loves: [], friction: [], requests: [] },
    operations: { summary: "", notes: [] },
    suggestedFeatures: [],
    replyPlaybook: { tone: "", do: [], avoid: [] },
  };
}

function parseFeatures(value: unknown): SuggestedFeature[] {
  if (!Array.isArray(value)) return [];
  const effortOk = (e: string): e is FeatureEffort =>
    e === "quick" || e === "medium" || e === "project";
  const out: SuggestedFeature[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = text(row.title, 80);
    const why = text(row.why, 220);
    if (!title || !why) continue;
    const effortRaw = text(row.effort, 16).toLowerCase();
    out.push({
      title,
      why,
      basedOn: text(row.basedOn ?? row.based_on, 180),
      effort: effortOk(effortRaw) ? effortRaw : "medium",
    });
    if (out.length >= 6) break;
  }
  return out;
}

export function parseLocationInsightPayload(raw: string): {
  summary: string;
  sentiment: SentimentLabel;
  themes: string[];
  highlights: string[];
  risks: string[];
  analysis: ProfileAnalysis;
} {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const sentimentRaw = String(parsed.sentiment ?? "neutral");
  const sentiment: SentimentLabel = (
    ["positive", "mixed", "negative", "neutral"] as const
  ).includes(sentimentRaw as SentimentLabel)
    ? (sentimentRaw as SentimentLabel)
    : "neutral";

  const branding = (parsed.branding ?? {}) as Record<string, unknown>;
  const staff = (parsed.staff ?? {}) as Record<string, unknown>;
  const feedback = (parsed.customerFeedback ??
    parsed.customer_feedback ??
    {}) as Record<string, unknown>;
  const operations = (parsed.operations ?? {}) as Record<string, unknown>;
  const playbook = (parsed.replyPlaybook ?? parsed.reply_playbook ?? {}) as Record<
    string,
    unknown
  >;

  return {
    summary: text(parsed.summary, 900),
    sentiment,
    themes: strings(parsed.themes, 6, 80),
    highlights: strings(parsed.highlights, 4, 200),
    risks: strings(parsed.risks, 4, 200),
    analysis: {
      branding: {
        voice: text(branding.voice, 240),
        strengths: strings(branding.strengths, 4),
        gaps: strings(branding.gaps, 4),
      },
      staff: {
        summary: text(staff.summary, 320),
        praise: strings(staff.praise, 4),
        issues: strings(staff.issues, 4),
      },
      customerFeedback: {
        loves: strings(feedback.loves, 5),
        friction: strings(feedback.friction, 5),
        requests: strings(feedback.requests, 5),
      },
      operations: {
        summary: text(operations.summary, 320),
        notes: strings(operations.notes, 5),
      },
      suggestedFeatures: parseFeatures(
        parsed.suggestedFeatures ?? parsed.suggested_features
      ),
      replyPlaybook: {
        tone: text(playbook.tone, 200),
        do: strings(playbook.do, 4),
        avoid: strings(playbook.avoid, 4),
      },
    },
  };
}

function heuristicInsight(
  locationTitle: string,
  reviews: ReviewSample[],
  avgRating: number | null
): Omit<LocationInsight, "locationId" | "generatedAt" | "stale" | "sourceHash"> {
  const withComments = reviews.filter((r) => r.comment?.trim());
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
      ? `${locationTitle} has no synced reviews yet.`
      : `${locationTitle} has ${reviews.length} review${reviews.length === 1 ? "" : "s"}` +
        (avgRating != null ? ` averaging ${avgRating.toFixed(1)}★` : "") +
        `. ${positive.length} positive, ${negative.length} need attention` +
        (withComments.length
          ? `, ${withComments.length} with written feedback.`
          : ".");

  return {
    summary,
    sentimentLabel: sentiment,
    themes: [],
    highlights: positive
      .filter((r) => r.comment)
      .slice(0, 3)
      .map((r) => r.comment!.trim().slice(0, 140)),
    risks: negative
      .filter((r) => r.comment)
      .slice(0, 3)
      .map((r) => r.comment!.trim().slice(0, 140)),
    analysis: emptyAnalysis(),
    reviewCount: reviews.length,
    avgRating,
  };
}

function asAnalysis(value: unknown): ProfileAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyAnalysis();
  }
  try {
    return parseLocationInsightPayload(
      JSON.stringify({ summary: "cached", ...(value as object), sentiment: "neutral" })
    ).analysis;
  } catch {
    return emptyAnalysis();
  }
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

export class LocationInsightService {
  static async getCachedInsights(
    workspaceId: string,
    locationIds: string[],
    fingerprints: Map<string, string>
  ): Promise<Map<string, LocationInsight>> {
    const result = new Map<string, LocationInsight>();
    if (!locationIds.length) return result;

    const supabase = createAdminClient();
    const withAnalysis = await supabase
      .from("grm_location_insights")
      .select(
        `location_id, summary, sentiment_label, themes, highlights, risks, analysis,
         review_count, avg_rating, source_hash, generated_at, prompt_version`
      )
      .eq("workspace_id", workspaceId)
      .in("location_id", locationIds);

    const { data } =
      withAnalysis.error && /analysis/i.test(withAnalysis.error.message)
        ? await supabase
            .from("grm_location_insights")
            .select(
              `location_id, summary, sentiment_label, themes, highlights, risks,
               review_count, avg_rating, source_hash, generated_at, prompt_version`
            )
            .eq("workspace_id", workspaceId)
            .in("location_id", locationIds)
        : withAnalysis;

    for (const row of data ?? []) {
      const expected = fingerprints.get(row.location_id);
      const analysis = asAnalysis(
        "analysis" in row ? (row as { analysis?: unknown }).analysis : {}
      );
      const stale =
        !expected ||
        expected !== row.source_hash ||
        row.prompt_version !== INSIGHT_PROMPT_VERSION ||
        !hasRichAnalysis(analysis);
      result.set(row.location_id, {
        locationId: row.location_id,
        summary: row.summary,
        sentimentLabel: row.sentiment_label as SentimentLabel,
        themes: Array.isArray(row.themes) ? (row.themes as string[]) : [],
        highlights: Array.isArray(row.highlights)
          ? (row.highlights as string[])
          : [],
        risks: Array.isArray(row.risks) ? (row.risks as string[]) : [],
        analysis,
        reviewCount: row.review_count,
        avgRating: row.avg_rating != null ? Number(row.avg_rating) : null,
        sourceHash: row.source_hash,
        generatedAt: row.generated_at,
        stale,
      });
    }

    return result;
  }

  static async buildLocationReviewStats(
    workspaceId: string,
    locationIds: string[]
  ): Promise<
    Map<
      string,
      {
        fingerprint: string;
        reviews: ReviewSample[];
        avgRating: number | null;
        heuristic: ReturnType<typeof heuristicInsight>;
      }
    >
  > {
    const map = new Map<
      string,
      {
        fingerprint: string;
        reviews: ReviewSample[];
        avgRating: number | null;
        heuristic: ReturnType<typeof heuristicInsight>;
      }
    >();
    if (!locationIds.length) return map;

    const supabase = createAdminClient();
    const [{ data: locations }, { data: reviews }] = await Promise.all([
      supabase
        .from("grm_google_locations")
        .select("id, location_title")
        .eq("workspace_id", workspaceId)
        .in("id", locationIds),
      supabase
        .from("grm_reviews")
        .select("location_id, star_rating, comment, review_create_time")
        .eq("workspace_id", workspaceId)
        .in("location_id", locationIds)
        .order("review_create_time", { ascending: false }),
    ]);

    const titleById = new Map(
      (locations ?? []).map((l) => [l.id, l.location_title])
    );
    const byLoc = new Map<string, ReviewSample[]>();
    for (const id of locationIds) byLoc.set(id, []);
    for (const r of reviews ?? []) {
      const list = byLoc.get(r.location_id);
      if (!list) continue;
      if (list.length < MAX_REVIEW_SAMPLES) {
        list.push({
          star_rating: r.star_rating,
          comment: r.comment,
          review_create_time: r.review_create_time,
        });
      }
    }

    for (const [locationId, samples] of byLoc) {
      const avg =
        samples.length > 0
          ? samples.reduce((s, r) => s + r.star_rating, 0) / samples.length
          : null;
      const fingerprint = buildSourceFingerprint(locationId, samples, avg);
      const title = titleById.get(locationId) ?? "Location";
      map.set(locationId, {
        fingerprint,
        reviews: samples,
        avgRating: avg,
        heuristic: heuristicInsight(title, samples, avg),
      });
    }

    return map;
  }

  static async generateForLocation(
    workspaceId: string,
    locationId: string,
    userId: string,
    options: { force?: boolean } = {}
  ): Promise<LocationInsight> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AppError("Gemini API key not configured", "CONFIG_ERROR", 500);
    }

    const supabase = createAdminClient();
    const statsMap = await this.buildLocationReviewStats(workspaceId, [
      locationId,
    ]);
    const stats = statsMap.get(locationId);
    if (!stats) {
      throw new AppError("Location not found", "NOT_FOUND", 404);
    }

    if (!options.force) {
      const cached = await this.getCachedInsights(
        workspaceId,
        [locationId],
        new Map([[locationId, stats.fingerprint]])
      );
      const hit = cached.get(locationId);
      if (hit && !hit.stale) return hit;
    }

    const { data: location } = await supabase
      .from("grm_google_locations")
      .select("location_title, grm_clients(name)")
      .eq("id", locationId)
      .eq("workspace_id", workspaceId)
      .single();

    if (!location) {
      throw new AppError("Location not found", "NOT_FOUND", 404);
    }

    const clientData = location.grm_clients as
      | { name: string }
      | Array<{ name: string }>
      | null;
    const businessName = Array.isArray(clientData)
      ? (clientData[0]?.name ?? location.location_title)
      : (clientData?.name ?? location.location_title);

    if (stats.reviews.length === 0) {
      const empty = {
        ...stats.heuristic,
        locationId,
        sourceHash: stats.fingerprint,
        generatedAt: new Date().toISOString(),
        stale: false,
      };
      await this.upsertInsight(workspaceId, locationId, userId, empty);
      return empty;
    }

    const reviewBlock = stats.reviews
      .map(
        (r, i) =>
          `${i + 1}. ${r.star_rating}/5 — ${(readableReviewText(r.comment) ?? "(rating only)").slice(0, 400)}`
      )
      .join("\n");

    const prompt = `You are a reputation, branding, and customer-experience analyst for one Google Business Profile.

Business: "${businessName}"
Location: "${location.location_title}"
Reviews in this sample: ${stats.reviews.length}
Average rating: ${stats.avgRating?.toFixed(2) ?? "n/a"}

REVIEWS:
${reviewBlock}

Return ONLY valid JSON (no markdown) with this exact shape:
{
  "summary": "3-5 sentence briefing: reputation, what this location is known for, and the one thing to fix first",
  "sentiment": "positive" | "mixed" | "negative" | "neutral",
  "themes": ["up to 6 recurring themes"],
  "highlights": ["up to 4 praise points with evidence"],
  "risks": ["up to 4 reputation risks"],
  "branding": {
    "voice": "how customers describe the brand personality in one sentence",
    "strengths": ["up to 4 brand strengths from reviews"],
    "gaps": ["up to 4 brand or listing gaps, e.g. photos, categories, promises not matching experience"]
  },
  "staff": {
    "summary": "how customers talk about people who work here",
    "praise": ["staff praise, name a person only if a review does"],
    "issues": ["staff-related complaints"]
  },
  "customerFeedback": {
    "loves": ["what customers keep coming back for"],
    "friction": ["pain points: wait, price, cleanliness, parking, etc."],
    "requests": ["things customers ask for or wish existed"]
  },
  "operations": {
    "summary": "hours, queue, cleanliness, consistency, facilities",
    "notes": ["specific operational notes"]
  },
  "suggestedFeatures": [
    {
      "title": "short feature name this profile should add",
      "why": "what it would improve",
      "basedOn": "which review pattern justifies it",
      "effort": "quick" | "medium" | "project"
    }
  ],
  "replyPlaybook": {
    "tone": "how replies from this location should sound",
    "do": ["up to 4 reply habits"],
    "avoid": ["up to 4 things not to say"]
  }
}

Rules:
- Base every claim on the reviews. If evidence is thin, say so. Never invent staff names, services, or policies.
- suggestedFeatures must be specific to THIS profile. Mix Google listing ideas (photos, Q&A, products, booking, posts, attributes) with on-the-ground ideas (waitlist, staff name badges, kids menu, accessibility, parking signage) when the reviews support them.
- Prefer 4-6 suggestedFeatures. Use effort "quick" for listing/content changes, "medium" for process changes, "project" for bigger investment.
- Do not mention that you are an AI.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let parsed: ReturnType<typeof parseLocationInsightPayload>;
    try {
      const response = await fetch(geminiGenerateUrl(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 8192,
            topP: 0.9,
            responseMimeType: "application/json",
            thinkingConfig: GEMINI_THINKING_LOW,
          },
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const body = await response.text();
        logger.error("location_insight.gemini_failed", {
          status: response.status,
          body: body.slice(0, 200),
        });
        const fallback = {
          ...stats.heuristic,
          locationId,
          sourceHash: stats.fingerprint,
          generatedAt: new Date().toISOString(),
          stale: false,
        };
        await this.upsertInsight(workspaceId, locationId, userId, {
          ...fallback,
          summary: `${fallback.summary} (AI unavailable — showing automatic summary.)`,
        });
        return fallback;
      }

      const data = await response.json();
      const { text: rawText, finishReason } = extractGeminiText(data);
      if (finishReason === "MAX_TOKENS") {
        logger.warn("location_insight.truncated", {
          locationId,
          usage: (data as { usageMetadata?: unknown }).usageMetadata,
        });
        throw new AppError("AI insight was cut off. Please try again.", "AI_INVALID_RESPONSE", 502);
      }
      if (!rawText) {
        throw new AppError("Empty AI insight response", "AI_INVALID_RESPONSE", 502);
      }
      parsed = parseLocationInsightPayload(rawText);
      if (!parsed.summary) {
        throw new AppError("Invalid AI insight JSON", "AI_INVALID_RESPONSE", 502);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new AppError("AI insight timed out", "AI_TIMEOUT", 504);
      }
      logger.error("location_insight.generate_failed", {
        message: error instanceof Error ? error.message : "Unknown",
      });
      const fallback = {
        ...stats.heuristic,
        locationId,
        sourceHash: stats.fingerprint,
        generatedAt: new Date().toISOString(),
        stale: false,
      };
      await this.upsertInsight(workspaceId, locationId, userId, fallback);
      return fallback;
    } finally {
      clearTimeout(timeout);
    }

    const insight: LocationInsight = {
      locationId,
      summary: parsed.summary,
      sentimentLabel: parsed.sentiment,
      themes: parsed.themes,
      highlights: parsed.highlights,
      risks: parsed.risks,
      analysis: parsed.analysis,
      reviewCount: stats.reviews.length,
      avgRating: stats.avgRating,
      sourceHash: stats.fingerprint,
      generatedAt: new Date().toISOString(),
      stale: false,
    };

    await this.upsertInsight(workspaceId, locationId, userId, insight);

    await AuditService.log({
      workspaceId,
      userId,
      action: "location_insight.generated",
      entityType: "grm_location_insights",
      entityId: locationId,
      metadata: {
        model: MODEL_ID,
        promptVersion: INSIGHT_PROMPT_VERSION,
        reviewCount: insight.reviewCount,
      },
    });

    return insight;
  }

  private static async upsertInsight(
    workspaceId: string,
    locationId: string,
    userId: string,
    insight: Omit<LocationInsight, "stale">
  ): Promise<void> {
    const supabase = createAdminClient();
    const row = {
      workspace_id: workspaceId,
      location_id: locationId,
      summary: insight.summary,
      sentiment_label: insight.sentimentLabel,
      themes: insight.themes,
      highlights: insight.highlights,
      risks: insight.risks,
      analysis: insight.analysis as unknown as Json,
      review_count: insight.reviewCount,
      avg_rating: insight.avgRating,
      source_hash: insight.sourceHash,
      ai_model: MODEL_ID,
      prompt_version: INSIGHT_PROMPT_VERSION,
      generated_at: insight.generatedAt,
      generated_by: userId,
    };
    let { error } = await supabase
      .from("grm_location_insights")
      .upsert(row, { onConflict: "workspace_id,location_id" });

    if (error && /analysis/i.test(error.message)) {
      const withoutAnalysis = { ...row };
      delete (withoutAnalysis as { analysis?: Json }).analysis;
      const retry = await supabase
        .from("grm_location_insights")
        .upsert(withoutAnalysis, { onConflict: "workspace_id,location_id" });
      error = retry.error;
    }

    if (error) {
      logger.error("location_insight.upsert_failed", { dbError: error.message });
      throw new AppError("Failed to store location insight", "DB_ERROR", 500);
    }
  }
}
