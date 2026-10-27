import { describe, expect, it } from "vitest";
import { SqlQuery } from "@/lib/db/query";
import { devLoginEnabled } from "@/lib/auth/dev-login";

describe("native Postgres query compiler", () => {
  it("parameterizes filter values and quotes identifiers", () => {
    const attack = "x'); DROP TABLE grm_reviews; --";
    const query = new SqlQuery("grm_reviews").select("id,comment").eq("comment", attack).compile();
    expect(query.text).not.toContain(attack);
    expect(query.values).toEqual([attack]);
    expect(query.text).toContain('"t"."comment" = $1');
    expect(() => new SqlQuery("grm_reviews;drop table x")).toThrow();
    expect(() => new SqlQuery("grm_reviews").select("evil").compile()).toThrow();
  });
  it("compiles embedded inner relations with tenant joins and nested predicates", () => {
    const query = new SqlQuery("grm_reviews")
      .select("id, grm_google_locations!inner(location_title, grm_clients(name))")
      .eq("workspace_id", "tenant-a").eq("grm_google_locations.client_id", "client-a").compile();
    expect(query.text).toContain('"j1"."workspace_id" = "t"."workspace_id"');
    expect(query.text).toContain("EXISTS");
    expect(query.values).toContain("client-a");
    expect(query.text).toContain('public."grm_clients"');
  });
  it("counts without materializing review rows", () => {
    const query = new SqlQuery("grm_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", "a").compile();
    expect(query.text).toContain("count(*)");
    expect(query.text).not.toContain("jsonb_agg");
  });
  it("parses quoted search, nested boolean groups and empty IN safely", () => {
    const query = new SqlQuery("grm_reviews").select("id")
      .or('comment.ilike."%Hello, (world)%",and(star_rating.lte.2,reply_status.eq.none)')
      .in("location_id", []).compile();
    expect(query.values).toContain("%Hello, (world)%");
    expect(query.text).toContain(" OR ");
    expect(query.text).toContain("FALSE");
    expect(query.text).not.toContain("Hello");
    expect(() => new SqlQuery("grm_reviews").or("id.eq.x);delete")).toThrow();
  });
  it("serializes JSON arrays while preserving Postgres arrays", () => {
    const json = new SqlQuery("grm_insight_reports").insert({ location_ids: ["a", "b"], evidence_summary: { summary: "x" } }).compile();
    expect(json.values).toContain('["a","b"]');
    expect(json.values).toContain('{"summary":"x"}');
    const array = new SqlQuery("grm_google_connections").insert({ scopes: ["openid"] }).compile();
    expect(array.values).toEqual([["openid"]]);
  });
  it("keeps compare-and-set predicates on atomic updates", () => {
    const query = new SqlQuery("grm_ai_generation_jobs").update({ status: "running" }).eq("id", "job").eq("status", "queued").select("id,status").compile();
    expect(query.text).toContain('UPDATE public."grm_ai_generation_jobs" AS t SET');
    expect(query.text).toContain('"t"."status" = $2');
    expect(query.text).toContain("RETURNING *");
  });
});

describe("local login guard", () => {
  const enabled = { NODE_ENV: "development", AUTH_DEV_LOGIN: "true", AUTH_DEV_LOGIN_TOKEN: "secret", AUTH_URL: "http://localhost:3001" } as NodeJS.ProcessEnv;
  it("requires development, an explicit flag, a secret and a loopback origin", () => {
    expect(devLoginEnabled(enabled)).toBe(true);
    for (const override of [{ NODE_ENV: "production" }, { NODE_ENV: "test" }, { AUTH_DEV_LOGIN: "false" }, { AUTH_DEV_LOGIN_TOKEN: "" }, { AUTH_URL: "https://example.com" }]) {
      expect(devLoginEnabled({ ...enabled, ...override } as NodeJS.ProcessEnv)).toBe(false);
    }
  });
});
