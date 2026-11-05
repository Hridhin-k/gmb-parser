import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/lib/services/audit";
import { assertSafePublicReply } from "@/lib/services/reply-checks";
import { insertResolutionContact, resolutionContactSentence } from "@/lib/resolution-contact";

vi.mock("@/lib/services/audit", () => ({ AuditService: { log: vi.fn() } }));

describe("manual reply checks", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["save", "edit", "approve", "submit", "template"])(
    "accepts the inserted business phone and email at %s",
    async (stage) => {
      const sentence = resolutionContactSentence("both", { phone: "+91 98470 12345", email: "desk@example.com" });
      const content = insertResolutionContact("We are sorry your visit fell short.", sentence!);
      await expect(assertSafePublicReply({
        workspaceId: "ws-1", userId: "user-1", reviewId: "review-1", content, stage,
      })).resolves.toBeUndefined();
      expect(AuditService.log).not.toHaveBeenCalled();
    },
  );

  it("still blocks and audits a prohibited promise alongside business contacts", async () => {
    await expect(assertSafePublicReply({
      workspaceId: "ws-1", userId: "user-1", reviewId: "review-1",
      content: "We will refund your visit. Email desk@example.com.", stage: "save",
    })).rejects.toThrow("compensation");
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ codes: ["compensation"], stage: "save", reviewId: "review-1", errorMessage: expect.stringContaining("compensation") }),
    }));
  });
});
