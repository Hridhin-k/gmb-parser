import { describe, expect, it } from "vitest";
import { isSupportBlockedMutation } from "@/lib/support-view";

describe("isSupportBlockedMutation", () => {
  it("allows reads and auth/impersonate exits", () => {
    expect(isSupportBlockedMutation("GET", "/api/reviews/export")).toBe(false);
    expect(isSupportBlockedMutation("HEAD", "/api/anything")).toBe(false);
    expect(isSupportBlockedMutation("DELETE", "/api/platform/tenants/x/impersonate")).toBe(false);
    expect(isSupportBlockedMutation("POST", "/api/auth/signout")).toBe(false);
  });

  it("blocks mutating app APIs", () => {
    expect(isSupportBlockedMutation("POST", "/api/reviews/sync")).toBe(true);
    expect(isSupportBlockedMutation("PUT", "/api/clients/a/locations/b")).toBe(true);
    expect(isSupportBlockedMutation("PATCH", "/api/workspace/members")).toBe(true);
    expect(isSupportBlockedMutation("DELETE", "/api/reports/abc")).toBe(true);
  });

  it("ignores non-API URLs", () => {
    expect(isSupportBlockedMutation("POST", "/overview")).toBe(false);
    expect(isSupportBlockedMutation("POST", "https://example.com/hook")).toBe(false);
  });
});
