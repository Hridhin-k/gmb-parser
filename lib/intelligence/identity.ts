import { createHash } from "crypto";

/** Matches the dashboard bundle and escalation policy allow-list. */
export const SUMMARY_TIMEZONES = ["Asia/Kolkata", "UTC", "Asia/Dubai", "America/New_York"] as const;

export type SummaryTimezone = (typeof SUMMARY_TIMEZONES)[number];

export const INTELLIGENCE_SCHEMA_VERSION = "intelligence-schema-v1";
export const PLATFORM_TAXONOMY_VERSION = "taxonomy-v1";

export type IntelligenceScopeType = "organisation" | "group" | "location";
export type SummaryRangeKind = "all" | "bounded";

/**
 * Columns of the unique index grm_scope_summaries_identity.
 * All-time uses null bounds. Bounded windows use an inclusive start and an exclusive end.
 * membershipHash freezes who was in the scope when the row was written.
 */
export interface SummaryIdentity {
  workspaceId: string;
  scopeType: IntelligenceScopeType;
  scopeId: string;
  rangeKind: SummaryRangeKind;
  rangeStart: string | null;
  rangeEnd: string | null;
  timezone: SummaryTimezone;
  analysisVersion: string;
  taxonomyVersion: string;
  schemaVersion: string;
  promptVersion: string;
  membershipHash: string;
}

export function membershipHash(locationIds: readonly string[]): string {
  const unique = [...new Set(locationIds)].sort();
  return createHash("sha256").update(unique.join(",")).digest("hex").slice(0, 32);
}

export function assertSummaryIdentity(identity: SummaryIdentity): void {
  if (!SUMMARY_TIMEZONES.includes(identity.timezone)) {
    throw new Error("Unsupported summary timezone");
  }
  if (identity.membershipHash.length !== 32) {
    throw new Error("membershipHash must be 32 hex characters");
  }
  if (identity.rangeKind === "all") {
    if (identity.rangeStart !== null || identity.rangeEnd !== null) {
      throw new Error("An all-time summary has no start or end");
    }
    return;
  }
  if (!identity.rangeStart || !identity.rangeEnd) {
    throw new Error("A bounded summary needs both bounds");
  }
  const start = Date.parse(identity.rangeStart);
  const end = Date.parse(identity.rangeEnd);
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    throw new Error("range_start is inclusive and range_end is exclusive, so start must be earlier");
  }
}

/** Stable comparison key. The database enforces the same fields with NULLS NOT DISTINCT. */
export function summaryIdentityKey(identity: SummaryIdentity): string {
  assertSummaryIdentity(identity);
  return [
    identity.workspaceId,
    identity.scopeType,
    identity.scopeId,
    identity.rangeKind,
    identity.rangeKind === "all" ? "all" : identity.rangeStart,
    identity.rangeKind === "all" ? "all" : identity.rangeEnd,
    identity.timezone,
    identity.analysisVersion,
    identity.taxonomyVersion,
    identity.schemaVersion,
    identity.promptVersion,
    identity.membershipHash,
  ].join("|");
}

/** One intelligence row per review, content version, and analysis version. */
export function intelligenceRecordKey(
  reviewId: string,
  contentHash: string,
  analysisVersion: string
): string {
  return `${reviewId}|${contentHash}|${analysisVersion}`;
}
