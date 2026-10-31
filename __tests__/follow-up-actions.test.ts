import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/errors";

const { resolve, authorize } = vi.hoisted(() => ({ resolve: vi.fn(), authorize: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser: vi.fn(async () => ({ id: "owner" })) }));
vi.mock("@/lib/services/workspace", () => ({ ensurePersonalWorkspace: vi.fn(async () => ({ workspace_id: "workspace" })) }));
vi.mock("@/lib/services/access", () => ({ assertEscalationAction: authorize }));
vi.mock("@/lib/services/escalations", () => ({ EscalationService: { resolve } }));

import { POST } from "@/app/api/escalations/[escalationId]/route";
const escalationId = "11111111-1111-4111-8111-111111111111";
function complete(code = "handled") {
  return POST(new Request("http://localhost/api/escalations/test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resolve", code, note: "Replied and arranged a refund." }),
  }), { params: Promise.resolve({ escalationId }) });
}

describe("marking a customer follow-up done", () => {
  beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue(undefined); });

  it("records a general follow-up without claiming a callback or replacement", async () => {
    expect((await complete()).status).toBe(200);
    expect(resolve).toHaveBeenCalledWith({ workspaceId: "workspace", actorId: "owner", escalationId,
      code: "handled", note: "Replied and arranged a refund." });
  });

  it("still accepts the detailed outcomes existing teams use", async () => {
    expect((await complete("replacement_arranged")).status).toBe(200);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ code: "replacement_arranged" }));
  });

  it("still rejects someone without access to the follow-up", async () => {
    authorize.mockRejectedValueOnce(new AuthorizationError());
    expect((await complete()).status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });
});
