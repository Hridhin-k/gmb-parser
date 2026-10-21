import type { createAdminClient } from "@/lib/supabase/admin";
import {
  buildSummaryDocument,
  type SummaryDocument,
} from "@/lib/intelligence/summary-aggregate";
import { SUMMARY_DEFAULT_TIMEZONE, type SummaryWindow } from "@/lib/intelligence/summary-window";
import type { IntelligenceScopeType } from "@/lib/intelligence/identity";
import { loadSummaryReviews } from "@/lib/services/summary-service";
import { logger } from "@/lib/logger";

type Admin = ReturnType<typeof createAdminClient>;

const ALL_TIME_WINDOW: SummaryWindow = {
  kind: "all",
  start: null,
  end: null,
  timezone: SUMMARY_DEFAULT_TIMEZONE,
  label: "All time",
  comparison: null,
};

/**
 * Builds the all-time summary document for a scope from stored review
 * intelligence. Brief generation reads this aggregate (plus a few stored
 * evidence quotes) instead of sending raw reviews to the model. Returns
 * null when the scope has no reviews; throws only on database failure so
 * callers can fall back.
 */
export async function loadAllTimeSummaryBrief(
  admin: Admin,
  workspaceId: string,
  scopeType: IntelligenceScopeType,
  scopeId: string,
  locationIds: readonly string[]
): Promise<SummaryDocument | null> {
  if (locationIds.length === 0) return null;
  const reviews = await loadSummaryReviews(admin, workspaceId, locationIds);
  if (reviews.length === 0) return null;
  return buildSummaryDocument({
    scopeType,
    scopeId,
    locationIds,
    window: ALL_TIME_WINDOW,
    reviews,
  });
}

export async function tryAllTimeSummaryBrief(
  admin: Admin,
  workspaceId: string,
  scopeType: IntelligenceScopeType,
  scopeId: string,
  locationIds: readonly string[]
): Promise<SummaryDocument | null> {
  try {
    return await loadAllTimeSummaryBrief(admin, workspaceId, scopeType, scopeId, locationIds);
  } catch (error) {
    logger.warn("intelligence.summary_brief_unavailable", {
      workspaceId,
      scopeId,
      message: error instanceof Error ? error.message : "summary unavailable",
    });
    return null;
  }
}

/** The only facts a brief prompt may use when a summary is available. */
export function summaryBriefBlock(document: SummaryDocument, locationNames?: ReadonlyMap<string, string>): string {
  const lines = [
    `SUMMARY OF ALL ${document.coverage.reviewCount} REVIEWS (counted from stored review intelligence; never recount):`,
    `Average rating: ${document.metrics.averageRating?.toFixed(2) ?? "n/a"} from the sum of stars. Reviews with readable text: ${document.coverage.extractedCount}. Outlets with reviews: ${document.locations.filter((row) => row.reviewCount > 0).length}.`,
    `Most mentioned topics: ${document.topics.slice(0, 8).map((row) => `${row.label} (${row.reviews} reviews)`).join(", ") || "none recorded"}`,
    `Praise topics: ${document.praise.slice(0, 8).map((row) => `${row.label} (${row.reviews} reviews)`).join(", ") || "none recorded"}`,
    `Issue topics: ${document.issues.slice(0, 8).map((row) => `${row.label} (${row.reviews} reviews)`).join(", ") || "none recorded"}`,
  ];
  const reviewedLocations = document.locations.filter((row) => row.reviewCount > 0);
  if (reviewedLocations.length > 1) {
    lines.push(
      `By outlet: ${reviewedLocations
        .slice(0, 20)
        .map((row) => `${locationNames?.get(row.locationId) ?? row.locationId} (${row.reviewCount} reviews, average ${row.averageRating?.toFixed(2) ?? "n/a"})`)
        .join(", ")}`
    );
  }
  if (document.evidence.length > 0) {
    lines.push(
      "EVIDENCE QUOTES (each starts with the review id it came from):",
      ...document.evidence.slice(0, 12).map((item) => `id=${item.reviewId} · "${item.excerpt.replace(/\s+/g, " ").slice(0, 200)}"`)
    );
  }
  return lines.join("\n");
}

export function summaryEvidenceIds(document: SummaryDocument): string[] {
  return [...new Set(document.evidence.map((item) => item.reviewId))].slice(0, 12);
}
