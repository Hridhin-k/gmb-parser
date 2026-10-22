import { describe, expect, it } from "vitest";
import {
  isPlatformInviteExpired,
  isSuperAdminEmail,
  parseSuperAdminEmails,
  platformInviteExpiresAt,
  tenantGate,
} from "@/lib/platform-admin";

describe("super admin allowlist", () => {
  it("parses comma emails case-insensitively and dedupes", () => {
    expect(parseSuperAdminEmails(" Admin@Example.com, other@example.com , admin@example.com, nope")).toEqual([
      "admin@example.com",
      "other@example.com",
    ]);
  });
  it("matches only listed emails", () => {
    expect(isSuperAdminEmail("ADMIN@example.com", "admin@example.com")).toBe(true);
    expect(isSuperAdminEmail("tenant@example.com", "admin@example.com")).toBe(false);
    expect(isSuperAdminEmail("", "admin@example.com")).toBe(false);
    expect(isSuperAdminEmail("admin@example.com", "")).toBe(false);
    expect(isSuperAdminEmail("admin@example.com", undefined)).toBe(false);
  });
});

describe("platform invite expiry (7 days)", () => {
  it("expires exactly after 7 days", () => {
    const issued = Date.parse("2026-10-22T00:00:00.000Z");
    const expires = platformInviteExpiresAt(issued);
    expect(Date.parse(expires) - issued).toBe(7 * 24 * 60 * 60 * 1000);
    expect(isPlatformInviteExpired(expires, issued + 6 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(isPlatformInviteExpired(expires, issued + 7 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(isPlatformInviteExpired(null)).toBe(true);
  });
});

describe("tenantGate", () => {
  it("allows any active membership (grandfathered owners and team invitees)", () => {
    expect(tenantGate({ workspaceStatuses: ["suspended", "active"], hasLivePlatformInvite: false })).toBe("allowed");
  });
  it("blocks when every membership is suspended, and reports deleted only when all are deleted", () => {
    expect(tenantGate({ workspaceStatuses: ["suspended"], hasLivePlatformInvite: true })).toBe("suspended");
    expect(tenantGate({ workspaceStatuses: ["deleted", "deleted"], hasLivePlatformInvite: false })).toBe("deleted");
    expect(tenantGate({ workspaceStatuses: ["suspended", "deleted"], hasLivePlatformInvite: false })).toBe("suspended");
  });
  it("requires setup with a live invite and refuses without one", () => {
    expect(tenantGate({ workspaceStatuses: [], hasLivePlatformInvite: true })).toBe("setup");
    expect(tenantGate({ workspaceStatuses: [], hasLivePlatformInvite: false })).toBe("not_invited");
  });
  it("treats a missing status (pre-migration DB) as active", () => {
    expect(tenantGate({ workspaceStatuses: [null], hasLivePlatformInvite: false })).toBe("allowed");
  });
});
