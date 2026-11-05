import { afterEach, describe, expect, it, vi } from "vitest";
import { AIReviewService } from "@/lib/services/ai-review";
import { AuditService } from "@/lib/services/audit";
import { claimAiGenerationJob, failAiGenerationJob, type AiGenerationJob } from "@/lib/services/ai-generation-jobs";
import { AppError } from "@/lib/errors";

vi.mock("@/lib/services/audit", () => ({ AuditService: { log: vi.fn() } }));
vi.mock("@/lib/services/ai-generation-jobs", () => ({ claimAiGenerationJob: vi.fn(), completeAiGenerationJob: vi.fn(), createAiGenerationJob: vi.fn(), failAiGenerationJob: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("background AI save diagnostics", () => {
  it.each([0, 4])("records the failed save and whether another attempt is allowed after %s prior attempts", async (attempts) => {
    vi.mocked(claimAiGenerationJob).mockResolvedValue({ id: "job-a", kind: "reply", workspace_id: "workspace-a", user_id: "user-a",
      review_id: "review-a", location_id: "location-a", content: "private generated draft", payload: {}, model: "test-model", attempts } as AiGenerationJob);
    const error = new AppError("Failed to store AI draft", "DB_ERROR", 500);
    vi.spyOn(AIReviewService, "persistGeneratedDraft").mockRejectedValue(error);
    await AIReviewService.persistGenerationJob("job-a");
    expect(failAiGenerationJob).toHaveBeenCalledWith("job-a", attempts + 1, error);
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.persistence_failed", userId: "user-a", entityId: "job-a",
      metadata: expect.objectContaining({ reviewId: "review-a", errorCode: "DB_ERROR", errorMessage: "Failed to store AI draft", stage: "persist_draft", attempt: attempts + 1, retryable: attempts < 4 }) }));
    expect(JSON.stringify(vi.mocked(AuditService.log).mock.calls)).not.toContain("private generated draft");
  });
});
