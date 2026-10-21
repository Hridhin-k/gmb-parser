import type { Json } from "@/lib/types/supabase";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  classifyGeminiError,
  extractGeminiText,
  GEMINI_FAST_MODEL_ID,
  GEMINI_THINKING_MINIMAL,
  geminiGenerateUrl,
  logGeminiFailure,
} from "@/lib/gemini";
import type { DateRange } from "@/lib/date-range";
import {
  deepDivePrompt,
  validateDeepDive,
  type DeepDiveFindingFacts,
  type DeepDiveReviewText,
  type FindingDeepDive,
} from "@/lib/intelligence/deep-dive";
import { loadInsightBoard } from "@/lib/services/insight-report";
import { usageFromResponse } from "@/lib/services/intelligence-extract";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";

type Admin = ReturnType<typeof createAdminClient>;

export type DeepDiveResult =
  | { status: "ready"; deepDive: FindingDeepDive; reused: boolean }
  | { status: "unavailable" | "budget" | "failed"; notice: string };

const MAX_CITED_REVIEWS = 25;

/**
 * Generates (or reuses) a deep dive for one finding of the current
 * report. The model reads only the finding's cited reviews — at most
 * 25 short texts — so one dive costs a fraction of a cent and every
 * number in it is checked against the finding before it is stored.
 * The result is stored on the report (metrics.deepDives), so reopening
 * the report never pays for it twice.
 */
export async function generateFindingDeepDive(
  admin: Admin,
  input: {
    userId: string;
    workspaceId: string;
    clientId?: string | null;
    groupId?: string | null;
    locationId?: string | null;
    range: DateRange;
    findingKey: string;
    force?: boolean;
  }
): Promise<DeepDiveResult> {
  const board = await loadInsightBoard(admin, input);
  const report = board.report;
  const finding = report?.findings.find((item) => item.key === input.findingKey);
  if (!report || !finding) {
    return { status: "unavailable", notice: "That finding is not part of the current report. Regenerate the report first." };
  }
  const existing = report.deepDives[input.findingKey];
  if (existing && !input.force) return { status: "ready", deepDive: existing, reused: true };

  const budget = await getAiBudget(admin, input.workspaceId);
  if (budget.exceeded) {
    return { status: "budget", notice: "The monthly AI budget is reached, so a deep dive cannot be generated right now." };
  }

  const reviewIds = finding.reviewIds.slice(0, MAX_CITED_REVIEWS);
  if (reviewIds.length === 0) {
    return { status: "unavailable", notice: "This finding has no cited reviews to read." };
  }
  const { data: reviewRows, error: reviewError } = await admin
    .from("grm_reviews")
    .select("id, star_rating, review_create_time, comment, location_id")
    .eq("workspace_id", input.workspaceId)
    .in("id", reviewIds);
  if (reviewError) throw new Error(reviewError.message);
  const locationIds = [...new Set((reviewRows ?? []).map((row) => row.location_id))];
  const { data: locationRows } = await admin
    .from("grm_google_locations")
    .select("id, location_title")
    .eq("workspace_id", input.workspaceId)
    .in("id", locationIds);
  const locationNames = new Map((locationRows ?? []).map((row) => [row.id, row.location_title ?? "Outlet"]));
  const byId = new Map((reviewRows ?? []).map((row) => [row.id, row]));
  const reviews: DeepDiveReviewText[] = reviewIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row?.comment?.trim()) return [];
    return [
      {
        stars: row.star_rating,
        location: locationNames.get(row.location_id) ?? "Outlet",
        date: row.review_create_time ? String(row.review_create_time).slice(0, 10) : "date unknown",
        comment: row.comment.replace(/\s+/g, " ").trim().slice(0, 500),
      },
    ];
  });
  if (reviews.length === 0) {
    return { status: "unavailable", notice: "The cited reviews have no readable text to dive into." };
  }

  const facts: DeepDiveFindingFacts = {
    title: finding.title,
    explanation: finding.explanation,
    whyItMatters: finding.whyItMatters,
    category: finding.category,
    evidenceCount: finding.evidenceCount,
    sampleSize: finding.sampleSize,
    metrics: finding.metrics,
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { status: "failed", notice: "AI is not configured, so a deep dive cannot be generated." };

  let deepDive: FindingDeepDive | null = null;
  for (let attempt = 0; attempt < 2 && !deepDive; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const prompt =
        deepDivePrompt(facts, reviews) +
        (attempt > 0
          ? "\n\nYour previous answer broke the number rules and was discarded. Use only the listed numbers and counts of the cited reviews. Do not use percentages."
          : "");
      const response = await fetch(geminiGenerateUrl(apiKey, GEMINI_FAST_MODEL_ID), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
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
        logGeminiFailure("intelligence.deep_dive_failed", response.status, body);
        const classified = classifyGeminiError(response.status, body);
        throw new Error(`${classified.type}: ${classified.message}`);
      }
      const data = await response.json();
      const usage = usageFromResponse(data);
      await recordAiUsage(admin, {
        workspaceId: input.workspaceId,
        operation: "insight_deep_dive",
        model: GEMINI_FAST_MODEL_ID,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      const { text } = extractGeminiText(data);
      if (!text) continue;
      deepDive = validateDeepDive(JSON.parse(text), facts, reviews.length, GEMINI_FAST_MODEL_ID, new Date().toISOString());
    } catch (error) {
      logger.warn("intelligence.deep_dive_attempt_failed", {
        workspaceId: input.workspaceId,
        findingKey: input.findingKey,
        attempt,
        message: error instanceof Error ? error.message.slice(0, 200) : "deep dive failed",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!deepDive) {
    return { status: "failed", notice: "The deep dive could not be generated cleanly, so nothing was stored. Try again in a moment." };
  }

  // Store on the report so every later view reuses it for free.
  const { data: reportRow, error: reportError } = await admin
    .from("grm_insight_reports")
    .select("metrics")
    .eq("workspace_id", input.workspaceId)
    .eq("id", report.id)
    .maybeSingle();
  if (reportError) throw new Error(reportError.message);
  const metrics = (reportRow?.metrics ?? {}) as Record<string, unknown>;
  const stored = (metrics.deepDives ?? {}) as Record<string, unknown>;
  const nextMetrics = { ...metrics, deepDives: { ...stored, [input.findingKey]: deepDive } };
  const { error: updateError } = await admin
    .from("grm_insight_reports")
    .update({ metrics: nextMetrics as Json })
    .eq("workspace_id", input.workspaceId)
    .eq("id", report.id);
  if (updateError) throw new Error(updateError.message);

  return { status: "ready", deepDive, reused: false };
}
