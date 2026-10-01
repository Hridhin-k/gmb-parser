import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AuditService } from "./audit";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const MODEL_ID = "gemini-2.0-flash";
const PROMPT_VERSION = "insight-v1.0";
const REQUEST_TIMEOUT_MS = 35_000;
/** Cap review snippets sent to the model to control tokens/cost. */
const MAX_REVIEW_SAMPLES = 40;

export type SentimentLabel = "positive" | "mixed" | "negative" | "neutral";

export interface LocationInsight {
  locationId: string;
  summary: string;
  sentimentLabel: SentimentLabel;
  themes: string[];
  highlights: string[];
  risks: string[];
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
    reviewCount: reviews.length,
    avgRating,
  };
}

function parseInsightJson(raw: string): {
  summary: string;
  sentiment: SentimentLabel;
  themes: string[];
  highlights: string[];
  risks: string[];
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

  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 200)).slice(0, 6)
      : [];

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 800) : "",
    sentiment,
    themes: asStringArray(parsed.themes),
    highlights: asStringArray(parsed.highlights),
    risks: asStringArray(parsed.risks),
  };
}

export class LocationInsightService {
  /**
   * Returns cached insights for locations. Does not call Gemini.
   * Marks entries stale when the underlying review set has changed.
   */
  static async getCachedInsights(
    workspaceId: string,
    locationIds: string[],
    fingerprints: Map<string, string>
  ): Promise<Map<string, LocationInsight>> {
    const result = new Map<string, LocationInsight>();
    if (!locationIds.length) return result;

    const supabase = createAdminClient();
    const { data } = await supabase
      .from("grm_location_insights")
      .select(
        `location_id, summary, sentiment_label, themes, highlights, risks,
         review_count, avg_rating, source_hash, generated_at`
      )
      .eq("workspace_id", workspaceId)
      .in("location_id", locationIds);

    for (const row of data ?? []) {
      const expected = fingerprints.get(row.location_id);
      const stale = !expected || expected !== row.source_hash;
      result.set(row.location_id, {
        locationId: row.location_id,
        summary: row.summary,
        sentimentLabel: row.sentiment_label as SentimentLabel,
        themes: Array.isArray(row.themes) ? (row.themes as string[]) : [],
        highlights: Array.isArray(row.highlights)
          ? (row.highlights as string[])
          : [],
        risks: Array.isArray(row.risks) ? (row.risks as string[]) : [],
        reviewCount: row.review_count,
        avgRating: row.avg_rating != null ? Number(row.avg_rating) : null,
        sourceHash: row.source_hash,
        generatedAt: row.generated_at,
        stale,
      });
    }

    return result;
  }

  /**
   * Builds fingerprints + heuristic fallbacks for locations (no AI quota).
   */
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

  /**
   * Generates (or returns cached) AI insight for one location.
   * Skips Gemini when source_hash is unchanged unless force=true.
   */
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
          `${i + 1}. ${r.star_rating}/5 — ${(r.comment ?? "(rating only)").slice(0, 280)}`
      )
      .join("\n");

    const prompt = `You are a reputation analyst for Google Business Profile reviews.

Business: "${businessName}"
Location: "${location.location_title}"
Review count in sample: ${stats.reviews.length}
Average rating: ${stats.avgRating?.toFixed(2) ?? "n/a"}

REVIEWS:
${reviewBlock}

Return ONLY valid JSON (no markdown) with this shape:
{
  "summary": "2-4 sentence executive summary of reputation for this location",
  "sentiment": "positive" | "mixed" | "negative" | "neutral",
  "themes": ["up to 5 recurring themes"],
  "highlights": ["up to 3 short positive points customers mention"],
  "risks": ["up to 3 short issues to address"]
}

Rules:
- Base claims only on the reviews provided. Do not invent facts.
- Be specific and actionable. Avoid fluff.
- If few reviews, say so and keep confidence low in the summary.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let parsed: ReturnType<typeof parseInsightJson>;
    try {
      const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 700,
            topP: 0.9,
            responseMimeType: "application/json",
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
        // Fall back to heuristic so the UI still works under quota pressure
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
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text || typeof text !== "string") {
        throw new AppError("Empty AI insight response", "AI_INVALID_RESPONSE", 502);
      }
      parsed = parseInsightJson(text);
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
        promptVersion: PROMPT_VERSION,
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
    const { error } = await supabase.from("grm_location_insights").upsert(
      {
        workspace_id: workspaceId,
        location_id: locationId,
        summary: insight.summary,
        sentiment_label: insight.sentimentLabel,
        themes: insight.themes,
        highlights: insight.highlights,
        risks: insight.risks,
        review_count: insight.reviewCount,
        avg_rating: insight.avgRating,
        source_hash: insight.sourceHash,
        ai_model: MODEL_ID,
        prompt_version: PROMPT_VERSION,
        generated_at: insight.generatedAt,
        generated_by: userId,
      },
      { onConflict: "workspace_id,location_id" }
    );

    if (error) {
      logger.error("location_insight.upsert_failed", { dbError: error.message });
      throw new AppError("Failed to store location insight", "DB_ERROR", 500);
    }
  }
}
