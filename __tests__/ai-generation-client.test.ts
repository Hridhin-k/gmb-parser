import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savedReplyId } from "@/lib/ai-generation-client";

describe("using a generated reply after persistence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("waits for the background save and returns the stored reply id", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "persisting" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "saved", replyId: "reply-stored" })));
    vi.stubGlobal("fetch", fetch);
    const result = savedReplyId({ replyId: "pending:job-1", jobId: "job-1" });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("reply-stored");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses a synchronously saved reply directly", async () => {
    await expect(savedReplyId({ replyId: "reply-stored" })).resolves.toBe("reply-stored");
  });

  it("does not expose a provisional id when saving failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "failed", replyId: "reply-incomplete" }))));
    const result = expect(savedReplyId({ replyId: "pending:job-1", jobId: "job-1" })).rejects.toThrow("before sending");
    await vi.runAllTimersAsync();
    await result;
  });
});
