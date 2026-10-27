import { describe, expect, it } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideHttpTarget, loadCookieHeader } from "../bench/http-safety";
import { STAGING_REF, PRODUCTION_REF } from "../bench/safety";

describe("decideHttpTarget", () => {
  it("refuses missing confirm and production supabase url", () => {
    expect(
      decideHttpTarget({
        baseUrl: "http://127.0.0.1:3000",
        confirm: "staging",
        supabaseUrl: `https://${PRODUCTION_REF}.supabase.co`,
      }).ok
    ).toBe(false);
    expect(
      decideHttpTarget({
        baseUrl: "http://127.0.0.1:3000",
        confirm: "local",
        supabaseUrl: `https://${STAGING_REF}.supabase.co`,
      }).ok
    ).toBe(false);
  });

  it("allows loopback against staging", () => {
    const decision = decideHttpTarget({
      baseUrl: "http://127.0.0.1:3000",
      confirm: "staging",
      supabaseUrl: `https://${STAGING_REF}.supabase.co`,
    });
    expect(decision.ok).toBe(true);
    expect(decision.projectRef).toBe(STAGING_REF);
  });

  it("refuses arbitrary remote hosts", () => {
    expect(
      decideHttpTarget({
        baseUrl: "https://app.revupilot.example",
        confirm: "staging",
        supabaseUrl: `https://${STAGING_REF}.supabase.co`,
      }).ok
    ).toBe(false);
  });
});

describe("loadCookieHeader", () => {
  it("accepts staging CDP dump and refuses production cookie names", () => {
    const stagingPath = join(tmpdir(), `rp-cookie-staging-${process.pid}.json`);
    const prodPath = join(tmpdir(), `rp-cookie-prod-${process.pid}.json`);
    writeFileSync(
      stagingPath,
      JSON.stringify([{ name: `sb-${STAGING_REF}-auth-token`, value: "x".repeat(40) }])
    );
    writeFileSync(
      prodPath,
      JSON.stringify([{ name: `sb-${PRODUCTION_REF}-auth-token`, value: "y".repeat(40) }])
    );
    try {
      const ok = loadCookieHeader(stagingPath);
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.cookieNames[0]).toContain(STAGING_REF);
        expect(ok.valueChars).toBe(40);
      }
      expect(loadCookieHeader(prodPath).ok).toBe(false);
    } finally {
      unlinkSync(stagingPath);
      unlinkSync(prodPath);
    }
  });
});
