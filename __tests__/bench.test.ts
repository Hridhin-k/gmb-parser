import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateReviews,
  buildPlan,
  PHRASES,
  planSummary,
  reviewBatches,
  reviewName,
  workspaceSlug,
} from "../bench/dataset";
import { canAdvance, percentile, shouldStop, summarize, verdictFor, type LatencySample } from "../bench/metrics";
import { parseArgs } from "../bench/run";
import { payloadsEqual } from "../bench/compare-dashboard-bundle";
import { extractFunctionBody, isExplainableQuery, splitSqlStatements } from "../bench/extract-sql";
import {
  decideTarget,
  discardGeminiCredentials,
  redactDatabaseUrl,
  serverAddressAllowed,
  STAGING_REF,
} from "../bench/safety";
import { assertWorkloadsStayInside, bindWorkload, WORKLOADS, type WorkloadContext } from "../bench/workloads";

const sql = readFileSync(path.join(process.cwd(), "bench/sql/install.sql"), "utf8");

describe("bench dataset", () => {
  it("is deterministic and unequal", () => {
    const first = allocateReviews(100, 1_000_000);
    const second = allocateReviews(100, 1_000_000);
    expect(first).toEqual(second);
    expect(first.reduce((sum, count) => sum + count, 0)).toBe(1_000_000);
    expect(Math.max(...first)).toBeGreaterThanOrEqual(100_000);
    expect(Math.max(...first)).toBeGreaterThan(Math.min(...first));
  });

  it("does not invent a 100k tenant inside a 100k dataset", () => {
    const counts = allocateReviews(500, 100_000);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(100_000);
    expect(Math.max(...counts)).toBeLessThan(100_000);
    const plan = buildPlan({ tenants: 500, reviews: 100_000 });
    expect(plan.deviations.some((line) => line.includes("No tenant has 100,000 reviews"))).toBe(true);
  });

  it("gives the high volumes a large tenant and samples analyses above one million", () => {
    for (const reviews of [1_000_000, 10_000_000, 50_000_000]) {
      for (const tenants of [100, 250, 500] as const) {
        const plan = buildPlan({ tenants, reviews });
        const summary = planSummary(plan);
        expect(summary.largest).toBeGreaterThanOrEqual(100_000);
        expect(summary.locations).toBeGreaterThan(tenants);
        expect(summary.maxLocations).toBeLessThanOrEqual(80);
      }
    }
    expect(buildPlan({ tenants: 100, reviews: 10_000_000 }).analyses).toBe("sample");
    expect(buildPlan({ tenants: 100, reviews: 1_000_000 }).analyses).toBe("full");
  });

  it("covers every review index once and resumes after a checkpoint", () => {
    const plan = buildPlan({ tenants: 100, reviews: 100_000, batchSize: 20_000 });
    const batches = reviewBatches(plan);
    const covered = new Set<string>();
    for (const batch of batches) {
      for (let index = batch.from; index <= batch.to; index += 1) covered.add(`${batch.tenantIndex}:${index}`);
    }
    const expected = plan.rows.reduce((sum, row) => sum + row.reviews, 0);
    expect(covered.size).toBe(expected);
    const resumed = reviewBatches(plan, 20_000);
    expect(resumed.every((batch) => batch.globalEnd > 20_000)).toBe(true);
    expect(resumed.length).toBeLessThan(batches.length);
  });

  it("uses synthetic text and bench identifiers", () => {
    expect(PHRASES.join(" ")).not.toMatch(/@|\b\d{3}[-.\s]\d{3}\b/);
    expect(reviewName(20261027, 3, 12)).toBe("bench/20261027/t0003/r000000000012");
    expect(workspaceSlug(20261027, 3)).toMatch(/^bench-20261027-0003$/);
    const plan = buildPlan({ tenants: 100, reviews: 1_000_000 });
    expect(plan.rows[0].workspaceId).toBe(buildPlan({ tenants: 100, reviews: 1_000_000 }).rows[0].workspaceId);
    expect(plan.rows[0].clients).toHaveLength(3);
    expect(plan.rows[0].locationRows.length).toBeGreaterThanOrEqual(2);
  });
});

describe("bench safety", () => {
  it("refuses production, hosted Supabase, Google, and Gemini", () => {
    expect(decideTarget({ databaseUrl: "postgres://u:p@db.yzagcxdzlsjpowokqewm.supabase.co:5432/postgres", confirm: "local" }).ok).toBe(false);
    expect(decideTarget({ databaseUrl: "postgres://u:p@example.supabase.co:5432/postgres", confirm: "staging", stagingHost: "example.supabase.co" }).ok).toBe(false);
    expect(decideTarget({ databaseUrl: "https://mybusiness.googleapis.com/v4/reviews", confirm: "local" }).ok).toBe(false);
    expect(decideTarget({ databaseUrl: "https://generativelanguage.googleapis.com/v1/models", confirm: "local" }).ok).toBe(false);
  });

  it("drops a loaded model key before any fixture evidence is written", () => {
    const env = { GEMINI_API_KEY: "real-key", GEMINI_MODEL_ID: "gemini-3.8-flash", BENCH_CONFIRM: "local" } as unknown as NodeJS.ProcessEnv;
    expect(discardGeminiCredentials(env)).toEqual(["GEMINI_API_KEY", "GEMINI_MODEL_ID"]);
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.BENCH_CONFIRM).toBe("local");
    expect(sql).toContain("u.comment");
    expect(sql).not.toContain("left(u.comment");
  });

  it("allows only a confirmed loopback or an explicit staging host", () => {
    expect(decideTarget({ databaseUrl: "postgres://postgres@127.0.0.1:54322/postgres" }).ok).toBe(false);
    expect(decideTarget({ databaseUrl: "postgres://postgres@127.0.0.1:54322/postgres", confirm: "local" }).ok).toBe(true);
    expect(
      decideTarget({
        databaseUrl: "postgres://bench@10.0.0.8:5432/bench",
        confirm: "staging",
        stagingHost: "10.0.0.8",
      }).ok
    ).toBe(true);
    const stagingHost = `db.${STAGING_REF}.supabase.co`;
    expect(
      decideTarget({
        databaseUrl: `postgres://postgres:secret@${stagingHost}:6543/postgres`,
        confirm: "staging",
        stagingHost,
      }).ok
    ).toBe(true);
    expect(
      decideTarget({
        databaseUrl: `postgres://postgres:secret@${stagingHost}:6543/postgres`,
        confirm: "local",
        stagingHost,
      }).ok
    ).toBe(false);
    expect(
      decideTarget({
        databaseUrl: "postgres://postgres:secret@db.yzagcxdzlsjpowokqewm.supabase.co:6543/postgres",
        confirm: "staging",
        stagingHost: "db.yzagcxdzlsjpowokqewm.supabase.co",
      }).ok
    ).toBe(false);
    expect(redactDatabaseUrl("postgres://postgres:secret@127.0.0.1:5432/bench")).not.toContain("secret");
  });

  it("accepts a Docker bridge address only for a loopback URL", () => {
    expect(serverAddressAllowed("172.17.0.2/32", "127.0.0.1")).toBe(true);
    expect(serverAddressAllowed(null, "127.0.0.1")).toBe(true);
    expect(serverAddressAllowed("172.17.0.2", "10.0.0.8")).toBe(false);
    expect(serverAddressAllowed("8.8.8.8", "127.0.0.1")).toBe(false);
  });
});

describe("dashboard bundle payload equality", () => {
  it("treats unordered location arrays as equal regardless of order", () => {
    const left = {
      reviews: 2,
      locations: [
        { location_id: "a", reviews: 1 },
        { location_id: "b", reviews: 1 },
      ],
    };
    const right = {
      reviews: 2,
      locations: [
        { location_id: "b", reviews: 1 },
        { location_id: "a", reviews: 1 },
      ],
    };
    expect(payloadsEqual(left, right)).toEqual({ ok: true, detail: "equal" });
  });

  it("flags a scalar mismatch", () => {
    expect(payloadsEqual({ reviews: 1 }, { reviews: 2 }).ok).toBe(false);
  });
});

describe("function body extraction", () => {
  it("reads a pg_get_functiondef body tagged $function$", () => {
    const source = `CREATE OR REPLACE FUNCTION public.grm_dashboard_bundle(p_workspace_id uuid)
 LANGUAGE sql
AS $function$
  select 1
$function$
`;
    const extracted = extractFunctionBody(source, "pg_get_functiondef(grm_dashboard_bundle)", "grm_dashboard_bundle");
    expect(extracted.tag).toBe("$function$");
    expect(extracted.body).toBe("select 1");
  });

  it("keeps a statement together when a comment contains a semicolon", () => {
    const body = `-- fingerprint; still a comment\nwith scoped as (select 1 as n)\nselect n from scoped;`;
    const statements = splitSqlStatements(body).filter(isExplainableQuery);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/with scoped/);
  });

  it("names the missing delimiter instead of writing an empty file", () => {
    const source = "create function public.grm_dashboard_bundle(id uuid)\nlanguage sql\nas select 1;\n";
    expect(() => extractFunctionBody(source, "sample.sql", "grm_dashboard_bundle")).toThrow(
      /sample\.sql: function grm_dashboard_bundle has no dollar-quote opener/
    );
  });
});

describe("bench workloads", () => {
  it("stays off Google and Gemini and binds every parameter", () => {
    assertWorkloadsStayInside();
    expect(sql.toLowerCase()).not.toContain("googleapis");
    expect(sql.toLowerCase()).not.toContain("generativelanguage");
    expect(sql.toLowerCase()).not.toContain("gemini");
    expect(sql.toLowerCase()).not.toContain("generatecontent");
    expect(sql).toContain("revoked");
    expect(sql).toContain("example.invalid");
    expect(sql).toContain("on conflict (workspace_id, google_review_name)");
    expect(sql).toMatch(/rollback/i);
    const ctx: WorkloadContext = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      otherWorkspaceId: "00000000-0000-4000-8000-000000000002",
      locationId: "00000000-0000-4000-8000-000000000003",
      groupId: "00000000-0000-4000-8000-000000000004",
      locationIds: ["00000000-0000-4000-8000-000000000003"],
      cacheKey: "bench:20261027:0",
      seed: 20261027,
      tenantIndex: 0,
    };
    for (const workload of WORKLOADS) {
      expect(bindWorkload(workload, ctx).length).toBeGreaterThan(0);
      expect(workload.sql.includes("workspace_id = $1") || workload.sql.includes("$1::uuid")).toBe(true);
    }
  });
});

describe("bench measurements", () => {
  it("stops on timeouts and does not advance past a slow step", () => {
    const samples: LatencySample[] = [
      ...Array.from({ length: 80 }, () => ({
        workload: "inbox.page_recent",
        ms: 40,
        ok: true,
        cold: false,
        timedOut: false,
        bytes: 100,
      })),
      ...Array.from({ length: 3 }, () => ({
        workload: "inbox.page_recent",
        ms: 15_000,
        ok: false,
        cold: false,
        timedOut: true,
        bytes: 0,
      })),
    ];
    const summary = summarize(samples, 4_000);
    expect(summary.timeouts).toBe(3);
    expect(summary.errorRate).toBeLessThan(0.05);
    expect(shouldStop(summary)).toMatch(/timeout/);
    expect(canAdvance(summary)).toBe(false);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
  });

  it("fails a warm target when the cold sample is slow", () => {
    const warm = summarize(
      [
        { workload: "dashboard.bundle_30d", ms: 120, ok: true, cold: false, timedOut: false, bytes: 400 },
        { workload: "dashboard.bundle_30d", ms: 140, ok: true, cold: false, timedOut: false, bytes: 400 },
      ],
      1_000
    );
    const verdict = verdictFor({ workload: "dashboard.bundle_30d", group: "dashboard", warm, coldMs: 900 });
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(/Cold sample/);
  });

  it("parses the command without opening a database", () => {
    expect(parseArgs(["--plan", "--tenants", "250", "--reviews", "1000000"]).reviews).toBe(1_000_000);
    expect(parseArgs(["--stage", "smoke"]).stage).toBe("smoke");
  });
});
