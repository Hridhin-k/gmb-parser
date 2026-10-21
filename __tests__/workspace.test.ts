import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromMock, createAdminClient } = vi.hoisted(() => {
  const fromMock = vi.fn();
  return {
    fromMock,
    createAdminClient: vi.fn(() => ({ from: fromMock })),
  };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  canApproveReplies,
  canSyncWorkspace,
  ensurePersonalWorkspace,
  personalWorkspaceName,
  personalWorkspaceSlug,
  pickActiveWorkspace,
} from "@/lib/services/workspace";

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  for (const method of ["select", "eq", "in", "order", "limit", "insert", "update"]) {
    api[method] = vi.fn(self);
  }
  api.single = vi.fn().mockResolvedValue(result);
  api.maybeSingle = vi.fn().mockResolvedValue(result);
  api.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return api;
}

describe("personalWorkspaceSlug", () => {
  it("builds a unique slug from the email and user id", () => {
    const slug = personalWorkspaceSlug(
      "Senior.Manager+ops@explaineddigital.com",
      "11111111-2222-3333-4444-555555555555"
    );
    expect(slug).toBe("senior-manager-ops-11111111222233334444555555555555");
    expect(SLUG.test(slug)).toBe(true);
  });

  it("stays valid when the email is missing", () => {
    const slug = personalWorkspaceSlug(null, "abc");
    expect(slug).toBe("workspace-abc");
    expect(SLUG.test(slug)).toBe(true);
  });

  it("is the same slug every time for one user", () => {
    const userId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(personalWorkspaceSlug("a@b.com", userId)).toBe(
      personalWorkspaceSlug("a@b.com", userId)
    );
  });
});

describe("personalWorkspaceName", () => {
  it("uses the email when present", () => {
    expect(personalWorkspaceName("maya@explained.digital")).toBe(
      "maya@explained.digital"
    );
  });

  it("falls back when the email is blank", () => {
    expect(personalWorkspaceName("  ")).toBe("My workspace");
    expect(personalWorkspaceName(null)).toBe("My workspace");
  });
});

describe("canApproveReplies", () => {
  it("allows owners and admins", () => {
    expect(canApproveReplies("owner")).toBe(true);
    expect(canApproveReplies("admin")).toBe(true);
  });

  it("blocks members", () => {
    expect(canApproveReplies("member")).toBe(false);
    expect(canApproveReplies(null)).toBe(false);
  });
});

describe("canSyncWorkspace", () => {
  it("allows the owner and an admin", () => {
    expect(canSyncWorkspace("owner")).toBe(true);
    expect(canSyncWorkspace("org_admin")).toBe(true);
    expect(canSyncWorkspace("admin")).toBe(true);
    expect(canSyncWorkspace("brand_manager")).toBe(false);
    expect(canSyncWorkspace("member")).toBe(false);
    expect(canSyncWorkspace(null)).toBe(false);
  });
});

describe("pickActiveWorkspace", () => {
  it("prefers the workspace marked active", () => {
    const chosen = pickActiveWorkspace([
      { workspace_id: "personal", active: false },
      { workspace_id: "invited", active: true },
    ]);
    expect(chosen?.workspace_id).toBe("invited");
  });

  it("uses the earliest membership when none is active", () => {
    const chosen = pickActiveWorkspace([
      { workspace_id: "first", active: false },
      { workspace_id: "second", active: false },
    ]);
    expect(chosen?.workspace_id).toBe("first");
  });
});

describe("ensurePersonalWorkspace", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns an existing membership without creating another workspace", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_workspace_invites") {
        return chain({ data: [], error: null });
      }
      if (table === "grm_workspace_members") {
        return chain({
          data: [
            {
              workspace_id: "ws-existing",
              joined_at: "2026-01-01T00:00:00.000Z",
              active: false,
            },
          ],
          error: null,
        });
      }
      if (table === "grm_workspaces") {
        return chain({ data: [{ id: "ws-existing", status: "active" }], error: null });
      }
      if (table === "grm_platform_invites") {
        return chain({ data: null, error: null });
      }
      if (table === "grm_platform_blocked_users") return chain({ data: null, error: null });
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      ensurePersonalWorkspace({
        id: "user-1",
        email: "hridhin@explaineddigital.com",
      })
    ).resolves.toEqual({ workspace_id: "ws-existing" });
  });

  it("refuses to auto-create a workspace for an uninvited user (invite-only)", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_workspace_invites") return chain({ data: [], error: null });
      if (table === "grm_workspace_members") return chain({ data: [], error: null });
      if (table === "grm_workspaces") return chain({ data: [], error: null });
      if (table === "grm_platform_invites") return chain({ data: null, error: null });
      if (table === "grm_platform_blocked_users") return chain({ data: null, error: null });
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      ensurePersonalWorkspace({ id: "user-2", email: "senior@explained.digital" })
    ).rejects.toMatchObject({ code: "PLATFORM_NOT_INVITED" });
  });

  it("asks a platform-invited owner to name their tenant instead of auto-creating", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_workspace_invites") return chain({ data: [], error: null });
      if (table === "grm_workspace_members") return chain({ data: [], error: null });
      if (table === "grm_workspaces") return chain({ data: [], error: null });
      if (table === "grm_platform_invites") {
        return chain({
          data: { id: "invite-1", email: "senior@explained.digital", expires_at: new Date(Date.now() + 60_000).toISOString(), status: "pending" },
          error: null,
        });
      }
      if (table === "grm_platform_blocked_users") return chain({ data: null, error: null });
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      ensurePersonalWorkspace({ id: "user-3", email: "Senior@Explained.Digital" })
    ).rejects.toMatchObject({ code: "TENANT_SETUP_REQUIRED" });
  });
});
