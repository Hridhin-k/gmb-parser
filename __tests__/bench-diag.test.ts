import { afterEach, describe, expect, it } from "vitest";
import {
  enterBenchDiagFromHeadersSync,
  isBenchDiagEnabled,
  recordCacheEvent,
  recordRpc,
  resetBenchDiagForTests,
  takeBenchDiag,
  peekBenchDiag,
} from "@/lib/bench-diag";
import { STAGING_SUPABASE_REF, PRODUCTION_SUPABASE_REF } from "@/lib/supabase/config";

afterEach(() => {
  resetBenchDiagForTests();
});

describe("isBenchDiagEnabled", () => {
  it("fails closed without flag or on production project", () => {
    expect(
      isBenchDiagEnabled({
        REVUPILOT_APP_DIAG: "1",
        NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv).ok
    ).toBe(false);
    expect(
      isBenchDiagEnabled({
        REVUPILOT_APP_DIAG: "0",
        NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv).ok
    ).toBe(false);
    expect(
      isBenchDiagEnabled({
        REVUPILOT_APP_DIAG: "1",
        NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv).ok
    ).toBe(false);
  });

  it("enables only for staging development with explicit flag", () => {
    expect(
      isBenchDiagEnabled({
        REVUPILOT_APP_DIAG: "1",
        NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv).ok
    ).toBe(true);
  });
});

describe("bench diag store", () => {
  it("stores a snapshot by id when enabled (React cache may be absent in vitest)", () => {
    const prev = { ...process.env };
    process.env.REVUPILOT_APP_DIAG = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`;
    process.env.NODE_ENV = "development";
    try {
      enterBenchDiagFromHeadersSync("benchtestid01");
      const peek = peekBenchDiag("benchtestid01");
      expect(peek?.id).toBe("benchtestid01");
      // Direct mutation via peek for unit scope when requestSlot is unavailable
      peek!.cache.miss += 1;
      peek!.cache.hit += 1;
      peek!.rpcs.push({ name: "grm_dashboard_bundle", ms: 12, ok: true });
      const snap = takeBenchDiag("benchtestid01");
      expect(snap?.cache).toEqual({ hit: 1, miss: 1, singleflight: 0 });
      expect(snap?.rpcs[0]?.name).toBe("grm_dashboard_bundle");
      expect(takeBenchDiag("benchtestid01")).toBeNull();
      // record* no-ops outside RSC request slot — still exported for runtime
      recordCacheEvent("hit");
      recordRpc("x", 1, true);
    } finally {
      process.env.REVUPILOT_APP_DIAG = prev.REVUPILOT_APP_DIAG;
      process.env.NEXT_PUBLIC_SUPABASE_URL = prev.NEXT_PUBLIC_SUPABASE_URL;
      process.env.NODE_ENV = prev.NODE_ENV;
    }
  });
});
