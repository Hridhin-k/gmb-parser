import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types/supabase";
import { logger } from "@/lib/logger";
import {
  applyOrgSummaryUpdate,
  ORG_SUMMARY_LOGIC_VERSION,
  type OrgSummaryState,
} from "@/lib/intelligence/org-summary";
import { loadSummaryReviews, invalidateLocationSummaries } from "@/lib/services/summary-service";

type Admin = ReturnType<typeof createAdminClient>;

function asState(value: unknown, clientId: string): OrgSummaryState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<OrgSummaryState>;
  if (raw.version !== 1 || typeof raw.contributions !== "object" || typeof raw.days !== "object") return null;
  return {
    version: 1,
    clientId,
    logicVersion: raw.logicVersion === ORG_SUMMARY_LOGIC_VERSION ? ORG_SUMMARY_LOGIC_VERSION : undefined,
    windowMonths:
      typeof raw.windowMonths === "number" && Number.isInteger(raw.windowMonths) && raw.windowMonths > 0
        ? raw.windowMonths
        : undefined,
    contributions: raw.contributions ?? {},
    days: raw.days ?? {},
  };
}

/** Loads the stored organisation summary. Null when none exists yet. */
export async function loadOrgSummaryState(
  admin: Admin,
  workspaceId: string,
  clientId: string
): Promise<OrgSummaryState | null> {
  try {
    const { data, error } = await admin
      .from("grm_org_summaries")
      .select("state")
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error || !data) return null;
    return asState(data.state, clientId);
  } catch {
    return null;
  }
}

export interface OrgSummaryUpdate {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  totalReviews: number;
  changed: boolean;
  /** True when this pass discarded the previous counters and counted the current readings. */
  rewritten: boolean;
  /** True when the grm_org_summaries table is not installed yet. */
  unavailable: boolean;
}

/**
 * Recounts the organisation summary from the current readings while the
 * stored counters are from the previous rules. Once that recount is saved
 * with extraction finished, later calls add, replace, and remove individual
 * reviews. Affected locations have their scoped summaries invalidated.
 */
export async function updateOrgSummary(
  admin: Admin,
  input: {
    workspaceId: string;
    clientId: string;
    locationIds: readonly string[];
    extractionComplete: boolean;
    /** When set, the stored summary is exactly this set. Reviews outside it are removed. */
    reviewIds?: readonly string[];
    /** When set, a stored summary from another window is discarded and rebuilt. */
    windowMonths?: number;
  }
): Promise<OrgSummaryUpdate> {
  const loaded = await loadSummaryReviews(admin, input.workspaceId, input.locationIds);
  const allowedIds = input.reviewIds ? new Set(input.reviewIds) : null;
  const reviews = allowedIds ? loaded.filter((review) => allowedIds.has(review.id)) : loaded;
  const existing = await loadOrgSummaryState(admin, input.workspaceId, input.clientId);
  const result = applyOrgSummaryUpdate(existing, input.clientId, reviews, input.extractionComplete, input.windowMonths);
  const changed = result.added + result.updated + result.removed > 0 || (result.rewritten && result.settled);
  const totalReviews = Object.keys(result.state.contributions).length;
  if (changed) {
    const { error } = await admin.from("grm_org_summaries").upsert(
      {
        workspace_id: input.workspaceId,
        client_id: input.clientId,
        state: result.state as unknown as Json,
        review_count: totalReviews,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,client_id" }
    );
    if (error) {
      logger.warn("intelligence.org_summary_save_failed", { workspaceId: input.workspaceId, message: error.message });
      return { added: result.added, updated: result.updated, removed: result.removed, skipped: result.skipped, totalReviews, changed: false, rewritten: result.rewritten, unavailable: true };
    }
    for (const locationId of result.affectedLocationIds) {
      await invalidateLocationSummaries(admin, input.workspaceId, locationId);
    }
  }
  return {
    added: result.added,
    updated: result.updated,
    removed: result.removed,
    skipped: result.skipped,
    rewritten: result.rewritten,
    totalReviews,
    changed,
    unavailable: false,
  };
}
