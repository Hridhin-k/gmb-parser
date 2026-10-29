import { describe, expect, it } from "vitest";
import { parseTenantFeatures } from "@/lib/services/platform";

describe("parseTenantFeatures", () => {
  it("defaults every known flag to on", () => {
    expect(parseTenantFeatures(null)).toEqual({
      automation: true,
      requests: true,
      reports: true,
    });
  });

  it("only turns a flag off when it is explicitly false", () => {
    expect(parseTenantFeatures({ requests: false, reports: true })).toEqual({
      automation: true,
      requests: false,
      reports: true,
    });
  });
});
