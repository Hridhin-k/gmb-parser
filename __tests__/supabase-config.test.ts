import { describe, expect, it } from "vitest";
import {
  PRODUCTION_SUPABASE_REF,
  STAGING_SUPABASE_REF,
  getSupabaseAdminConfig,
  getSupabasePublicConfig,
  projectRefFromSupabaseUrl,
} from "@/lib/supabase/config";

function fakeJwt(claims: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.sig`;
}

const stagingUrl = `https://${STAGING_SUPABASE_REF}.supabase.co`;
const productionUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const anonKey = fakeJwt({ role: "anon", ref: STAGING_SUPABASE_REF });
const serviceRoleKey = fakeJwt({ role: "service_role", ref: STAGING_SUPABASE_REF });

describe("projectRefFromSupabaseUrl", () => {
  it("extracts the project ref from a supabase host", () => {
    expect(projectRefFromSupabaseUrl(stagingUrl)).toBe(STAGING_SUPABASE_REF);
    expect(projectRefFromSupabaseUrl(productionUrl)).toBe(PRODUCTION_SUPABASE_REF);
  });

  it("returns null for non-supabase hosts", () => {
    expect(projectRefFromSupabaseUrl("https://example.com")).toBeNull();
  });
});

describe("getSupabasePublicConfig", () => {
  it("accepts staging configuration in development", () => {
    const config = getSupabasePublicConfig({
      url: stagingUrl,
      anonKey,
      nodeEnv: "development",
    });
    expect(config.projectRef).toBe(STAGING_SUPABASE_REF);
    expect(config.url).toBe(stagingUrl);
    expect(config.anonKey).toBe(anonKey);
    expect(Object.keys(config).sort()).toEqual(["anonKey", "projectRef", "url"]);
  });

  it("rejects the production project in local development", () => {
    expect(() =>
      getSupabasePublicConfig({
        url: productionUrl,
        anonKey,
        nodeEnv: "development",
      })
    ).toThrow(/refuses the production Supabase project/);
  });

  it("fails clearly when staging URL is missing in development", () => {
    expect(() =>
      getSupabasePublicConfig({
        url: "",
        anonKey,
        nodeEnv: "development",
      })
    ).toThrow(/requires NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("rejects a different non-staging project in development", () => {
    expect(() =>
      getSupabasePublicConfig({
        url: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
        anonKey,
        nodeEnv: "development",
      })
    ).toThrow(/expects staging project/);
  });

  it("rejects a service-role credential used as the public anon key", () => {
    expect(() =>
      getSupabasePublicConfig({
        url: stagingUrl,
        anonKey: serviceRoleKey,
        nodeEnv: "development",
      })
    ).toThrow(/must not be a service-role credential/);
  });

  it("preserves non-development behavior for production URL", () => {
    const config = getSupabasePublicConfig({
      url: productionUrl,
      anonKey,
      nodeEnv: "production",
    });
    expect(config.projectRef).toBe(PRODUCTION_SUPABASE_REF);
  });
});

describe("getSupabaseAdminConfig", () => {
  it("accepts staging admin configuration in development", () => {
    const config = getSupabaseAdminConfig({
      url: stagingUrl,
      serviceRoleKey,
      nodeEnv: "development",
    });
    expect(config.projectRef).toBe(STAGING_SUPABASE_REF);
    expect(config.serviceRoleKey).toBe(serviceRoleKey);
  });

  it("rejects production admin configuration in development", () => {
    expect(() =>
      getSupabaseAdminConfig({
        url: productionUrl,
        serviceRoleKey,
        nodeEnv: "development",
      })
    ).toThrow(/refuses the production Supabase project/);
  });

  it("fails when the service-role key is missing", () => {
    expect(() =>
      getSupabaseAdminConfig({
        url: stagingUrl,
        serviceRoleKey: "",
        nodeEnv: "development",
      })
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY is not configured/);
  });

  it("preserves non-development admin configuration for production", () => {
    const config = getSupabaseAdminConfig({
      url: productionUrl,
      serviceRoleKey,
      nodeEnv: "production",
    });
    expect(config.projectRef).toBe(PRODUCTION_SUPABASE_REF);
  });
});
