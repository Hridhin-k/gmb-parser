import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/errors";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOC_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUP_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const {
  getUserMock,
  fromMock,
  ensurePersonalWorkspace,
  saveReplySettings,
  generateForLocation,
  generateScope,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  ensurePersonalWorkspace: vi.fn(async () => ({ workspace_id: WS_A })),
  saveReplySettings: vi.fn(),
  generateForLocation: vi.fn(),
  generateScope: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}));

vi.mock("@/lib/services/workspace", () => ({
  ensurePersonalWorkspace,
  getMemberRole: vi.fn(async () => "owner"),
}));

vi.mock("@/lib/services/access", () => ({
  getMemberAccess: vi.fn(async () => ({
    userId: USER_A,
    workspaceId: WS_A,
    role: "owner",
    enabled: true,
    scope: { clientId: null, groupId: null, locationId: null },
  })),
  visibleClientIds: vi.fn(async () => null),
  assertScoped: vi.fn(),
  listScopeChoices: vi.fn(),
}));

vi.mock("@/lib/services/reply-settings", () => ({
  saveReplySettings,
  loadReplySettings: vi.fn(),
  previewReply: vi.fn(),
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

vi.mock("@/lib/services/location-insights", () => ({
  LocationInsightService: { generateForLocation },
}));

vi.mock("@/lib/services/scope-insights", () => ({
  ScopeInsightService: { generate: generateScope },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  AI_GENERATE_LIMIT: { limit: 8, windowMs: 60_000 },
}));

function tableResult(data: unknown) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  for (const key of ["select", "eq", "neq", "in", "order", "limit", "update", "insert", "delete"]) {
    api[key] = vi.fn(self);
  }
  api.single = vi.fn(() => Promise.resolve({ data, error: null }));
  api.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  return api;
}

describe("settings reply isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: USER_A, email: "a@example.com" } } });
  });

  it("rejects saving tone for a client denied by access checks", async () => {
    saveReplySettings.mockRejectedValueOnce(
      new AuthorizationError("That brand is not in this organization.")
    );

    const { POST } = await import("@/app/api/settings/reply/route");
    const response = await POST(
      new Request("http://localhost/api/settings/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          target: { kind: "client", id: CLIENT_B },
          tone: {
            greeting: null,
            signoff: null,
            warmth: "friendly",
            length: "standard",
            languages: ["en"],
            neverSay: [],
            spellings: [],
          },
          automation: {
            enabled: false,
            minStars: 4,
            excludeQuestions: true,
            dailyCap: 10,
            holdbackMinutes: 60,
            windowStart: null,
            windowEnd: null,
            shadowMode: true,
            varyWording: false,
          },
        }),
      })
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/not in this organization|permission/i);
    expect(ensurePersonalWorkspace).toHaveBeenCalled();
  });
});

describe("insights generate isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: USER_A, email: "a@example.com" } } });
  });

  it("rejects generating for a location in another workspace", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_google_locations") {
        return tableResult({ id: LOC_B, workspace_id: WS_B, client_id: CLIENT_B });
      }
      if (table === "grm_workspace_members") {
        return tableResult(null);
      }
      return tableResult(null);
    });

    const { POST } = await import("@/app/api/insights/generate/route");
    const response = await POST(
      new Request("http://localhost/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: LOC_B }),
      })
    );
    expect(response.status).toBe(403);
    expect(generateForLocation).not.toHaveBeenCalled();
  });

  it("rejects generating for a foreign client scope id", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_clients") {
        return tableResult({ id: CLIENT_B, workspace_id: WS_B });
      }
      if (table === "grm_workspace_members") {
        return tableResult(null);
      }
      return tableResult(null);
    });

    const { POST } = await import("@/app/api/insights/generate/route");
    const response = await POST(
      new Request("http://localhost/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeKind: "client", scopeId: CLIENT_B }),
      })
    );
    expect(response.status).toBe(403);
    expect(generateScope).not.toHaveBeenCalled();
  });

  it("rejects a foreign group scope id", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "grm_clients") {
        return tableResult(null);
      }
      if (table === "grm_groups") {
        return tableResult({ id: GROUP_B, workspace_id: WS_B, client_id: CLIENT_B });
      }
      if (table === "grm_workspace_members") {
        return tableResult(null);
      }
      return tableResult(null);
    });

    const { POST } = await import("@/app/api/insights/generate/route");
    const response = await POST(
      new Request("http://localhost/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeKind: "group", scopeId: GROUP_B }),
      })
    );
    expect(response.status).toBe(403);
    expect(generateScope).not.toHaveBeenCalled();
  });
});
