import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  INTELLIGENCE_SCHEMA_VERSION,
  intelligenceRecordKey,
  membershipHash,
  summaryIdentityKey,
  type SummaryIdentity,
} from "@/lib/intelligence/identity";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOCATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_LOCATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function base(overrides: Partial<SummaryIdentity> = {}): SummaryIdentity {
  return {
    workspaceId: WORKSPACE,
    scopeType: "organisation",
    scopeId: ORG,
    rangeKind: "all",
    rangeStart: null,
    rangeEnd: null,
    timezone: "Asia/Kolkata",
    analysisVersion: "analysis-v1",
    taxonomyVersion: "taxonomy-v1",
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    promptVersion: "",
    membershipHash: membershipHash([LOCATION, OTHER_LOCATION]),
    ...overrides,
  };
}

describe("summary identity", () => {
  it("keeps an all-time organisation summary distinct from its last 12 months", () => {
    const allTime = summaryIdentityKey(base());
    const year = summaryIdentityKey(
      base({
        rangeKind: "bounded",
        rangeStart: "2025-10-20T00:00:00.000Z",
        rangeEnd: "2026-10-20T00:00:00.000Z",
      })
    );
    expect(year).not.toBe(allTime);
  });

  it("rejects an all-time row that invents a start date", () => {
    expect(() =>
      summaryIdentityKey(base({ rangeStart: "1970-01-01T00:00:00.000Z" }))
    ).toThrow(/no start or end/);
  });

  it("treats the end bound as exclusive", () => {
    const shared = {
      scopeType: "organisation" as const,
      rangeKind: "bounded" as const,
      rangeStart: "2026-01-01T00:00:00.000Z",
    };
    const throughMarch = summaryIdentityKey(base({ ...shared, rangeEnd: "2026-04-01T00:00:00.000Z" }));
    const throughMarchNext = summaryIdentityKey(base({ ...shared, rangeEnd: "2026-04-02T00:00:00.000Z" }));
    expect(throughMarch).not.toBe(throughMarchNext);
    expect(() =>
      summaryIdentityKey(base({ ...shared, rangeEnd: "2026-01-01T00:00:00.000Z" }))
    ).toThrow(/exclusive/);
  });

  it("does not let a group summary replace a location summary", () => {
    const group = summaryIdentityKey(
      base({
        scopeType: "group",
        scopeId: GROUP,
        membershipHash: membershipHash([LOCATION]),
      })
    );
    const location = summaryIdentityKey(
      base({
        scopeType: "location",
        scopeId: LOCATION,
        membershipHash: membershipHash([LOCATION]),
      })
    );
    expect(group).not.toBe(location);
  });

  it("includes the tenant and the frozen membership", () => {
    const here = summaryIdentityKey(base());
    const otherTenant = summaryIdentityKey(base({ workspaceId: OTHER }));
    const afterMove = summaryIdentityKey(base({ membershipHash: membershipHash([LOCATION]) }));
    expect(otherTenant).not.toBe(here);
    expect(afterMove).not.toBe(here);
    expect(summaryIdentityKey(base())).toBe(here);
  });

  it("hashes membership independent of input order", () => {
    expect(membershipHash([OTHER_LOCATION, LOCATION])).toBe(membershipHash([LOCATION, OTHER_LOCATION, LOCATION]));
  });
});

describe("review intelligence identity", () => {
  it("collapses the same review content and analysis version", () => {
    const review = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    expect(intelligenceRecordKey(review, "abc12345", "analysis-v1")).toBe(
      intelligenceRecordKey(review, "abc12345", "analysis-v1")
    );
    expect(intelligenceRecordKey(review, "abc12345", "analysis-v1")).not.toBe(
      intelligenceRecordKey(review, "changed1", "analysis-v1")
    );
  });
});

describe("migration constraints", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261020002_review_intelligence.sql"),
    "utf8"
  );

  it("defines the summary identity with nulls not distinct", () => {
    expect(sql).toContain("grm_scope_summaries_identity");
    expect(sql).toContain("nulls not distinct");
    for (const column of [
      "workspace_id",
      "scope_type",
      "scope_id",
      "range_kind",
      "range_start",
      "range_end",
      "timezone",
      "analysis_version",
      "taxonomy_version",
      "schema_version",
      "prompt_version",
      "membership_hash",
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("keeps one intelligence row per review content version", () => {
    expect(sql).toContain("unique (review_id, content_hash, analysis_version)");
  });

  it("does not replace the existing review or AI configuration tables", () => {
    expect(sql).not.toMatch(/drop table[^;]*grm_reviews/i);
    expect(sql).not.toMatch(/drop table[^;]*grm_ai_configs/i);
    expect(sql).not.toMatch(/drop table[^;]*grm_ai_knowledge/i);
  });
});
