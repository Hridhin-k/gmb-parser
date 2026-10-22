import type { DateRange } from "@/lib/date-range";
import {
  classifyGeminiError,
  extractGeminiText,
  GEMINI_FAST_MODEL_ID,
  GEMINI_THINKING_MINIMAL,
  geminiGenerateUrl,
  logGeminiFailure,
} from "@/lib/gemini";
import { logger } from "@/lib/logger";
import {
  latestPeriodReviews,
  parsePeriodInsight,
  PERIOD_INSIGHT_REVIEW_CAP,
  periodInsightPrompt,
  type PeriodInsightCard,
  type PeriodReviewLine,
} from "@/lib/period-gemini-insight";
import { readableReviewText } from "@/lib/review-text";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";
import { usageFromResponse } from "@/lib/services/intelligence-extract";
import { createAdminClient } from "@/lib/supabase/admin";

const CHUNK = 80;
const COMMENT_CAP = 400;
const REQUEST_TIMEOUT_MS = 40_000;
const CACHE_MS = 2 * 60 * 1000;

export interface PeriodInsightReady {
  status: "ready";
  scopeTitle: string;
  periodLabel: string;
  headline: string;
  summary: string;
  insights: PeriodInsightCard[];
  actions: string[];
  sampleSize: number;
  capped: boolean;
}

export type PeriodInsightView =
  | { status: "empty"; scopeTitle: string; periodLabel: string }
  | { status: "budget" | "unavailable"; notice: string }
  | PeriodInsightReady;

interface CacheEntry {
  at: number;
  value: PeriodInsightView;
}

const cache = new Map<string, CacheEntry>();

/**
 * Temporary: one Gemini reading of the latest reviews in the selected
 * scope and date window. Nothing is stored. A two-minute memory cache
 * only avoids a second call for the same window.
 */
export async function loadPeriodGeminiInsight(input: {
  workspaceId: string;
  locationIds: string[];
  places: Array<{ id: string; name: string }>;
  range: DateRange;
  scopeTitle: string;
}): Promise<PeriodInsightView> {
  const key = cacheKey(input);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const names = new Map(input.places.map((place) => [place.id, place.name]));
  const admin = createAdminClient();
  let loaded: { reviews: PeriodReviewLine[]; capped: boolean };
  try {
    loaded = await loadLatestReviews(admin, input.workspaceId, input.locationIds, names, input.range);
  } catch (error) {
    logger.warn("period_insight.load_failed", {
      workspaceId: input.workspaceId,
      message: error instanceof Error ? error.message.slice(0, 200) : "load failed",
    });
    return { status: "unavailable", notice: "Reviews for this period could not be loaded." };
  }
  if (loaded.reviews.length === 0) {
    const empty: PeriodInsightView = { status: "empty", scopeTitle: input.scopeTitle, periodLabel: input.range.label };
    remember(key, empty);
    return empty;
  }

  const budget = await getAiBudget(admin, input.workspaceId);
  if (budget.exceeded) {
    return { status: "budget", notice: "The monthly AI budget is reached, so this period was not sent to Gemini." };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { status: "unavailable", notice: "Gemini is not configured, so this period could not be read." };
  }

  const prompt = periodInsightPrompt({
    scopeTitle: input.scopeTitle,
    periodLabel: input.range.label,
    reviews: loaded.reviews,
    capped: loaded.capped,
  });
  let copy = null;
  for (let attempt = 0; attempt < 2 && !copy; attempt += 1) {
    const text = await askGemini(admin, apiKey, input.workspaceId, prompt, attempt > 0);
    if (!text) continue;
    copy = parsePeriodInsight(text);
  }
  if (!copy) {
    return { status: "unavailable", notice: "Gemini did not return a usable reading of these reviews. Refresh to try again." };
  }

  const ready: PeriodInsightView = {
    status: "ready",
    scopeTitle: input.scopeTitle,
    periodLabel: input.range.label,
    headline: copy.headline,
    summary: copy.summary,
    insights: copy.insights,
    actions: copy.actions,
    sampleSize: loaded.reviews.length,
    capped: loaded.capped,
  };
  remember(key, ready);
  return ready;
}

async function loadLatestReviews(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  locationIds: string[],
  names: Map<string, string>,
  range: DateRange
): Promise<{ reviews: PeriodReviewLine[]; capped: boolean }> {
  if (locationIds.length === 0) return { reviews: [], capped: false };
  const chunks: string[][] = [];
  for (let index = 0; index < locationIds.length; index += CHUNK) {
    chunks.push(locationIds.slice(index, index + CHUNK));
  }
  const start = range.start?.toISOString() ?? null;
  const end = range.end?.toISOString() ?? null;
  const batches = await Promise.all(
    chunks.map(async (chunk) => {
      let query = admin
        .from("grm_reviews")
        .select("star_rating, comment, review_create_time, location_id")
        .eq("workspace_id", workspaceId)
        .in("location_id", chunk)
        .is("missing_on_google_at", null)
        .order("review_create_time", { ascending: false })
        .limit(PERIOD_INSIGHT_REVIEW_CAP);
      if (start) query = query.gte("review_create_time", start);
      if (end) query = query.lt("review_create_time", end);
      const { data, error } = await query;
      if (error) throw new Error("Could not load reviews for this period");
      return data ?? [];
    })
  );
  const lines: PeriodReviewLine[] = [];
  let hitQueryCap = false;
  for (const rows of batches) {
    if (rows.length >= PERIOD_INSIGHT_REVIEW_CAP) hitQueryCap = true;
    for (const row of rows) {
      const text = readableReviewText(row.comment)?.slice(0, COMMENT_CAP) ?? "";
      lines.push({
        stars: row.star_rating,
        when: row.review_create_time,
        location: names.get(row.location_id) ?? "Outlet",
        text,
      });
    }
  }
  const latest = latestPeriodReviews(lines);
  return { reviews: latest.reviews, capped: latest.capped || hitQueryCap };
}

async function askGemini(
  admin: ReturnType<typeof createAdminClient>,
  apiKey: string,
  workspaceId: string,
  prompt: string,
  repair: boolean
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(geminiGenerateUrl(apiKey, GEMINI_FAST_MODEL_ID), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: repair ? `${prompt}\n\nReturn only the JSON object. No markdown.` : prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          thinkingConfig: GEMINI_THINKING_MINIMAL,
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      logGeminiFailure("period_insight.gemini_failed", response.status, body, { workspaceId });
      const classified = classifyGeminiError(response.status, body);
      logger.warn("period_insight.gemini_failed", { workspaceId, type: classified.type });
      return null;
    }
    const data = await response.json();
    const usage = usageFromResponse(data);
    await recordAiUsage(admin, {
      workspaceId,
      operation: "insight_brief",
      model: GEMINI_FAST_MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    const { text } = extractGeminiText(data);
    return text || null;
  } catch (error) {
    logger.warn("period_insight.gemini_failed", {
      workspaceId,
      message: error instanceof Error ? error.message.slice(0, 200) : "period insight failed",
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function cacheKey(input: {
  workspaceId: string;
  locationIds: string[];
  range: DateRange;
}): string {
  return [
    input.workspaceId,
    [...input.locationIds].sort().join(","),
    input.range.start?.toISOString() ?? "",
    input.range.end?.toISOString() ?? "",
  ].join("|");
}

function remember(key: string, value: PeriodInsightView): void {
  cache.set(key, { at: Date.now(), value });
}
