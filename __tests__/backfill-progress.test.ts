import { describe, expect, it } from "vitest";
import {
  clearBackfillProgress,
  getBackfillProgress,
  patchBackfillProgress,
  setBackfillProgress,
  tryStartBackfill,
} from "@/lib/services/backfill-progress";

describe("backfill progress store", () => {
  it("tracks a run from extracting to done", () => {
    setBackfillProgress("ws-1", {
      clientId: "client-1",
      phase: "extracting",
      pendingBefore: 100,
      processed: 0,
      rulesStored: 0,
      batchStored: 0,
      remaining: 100,
      notice: null,
      startedAt: new Date().toISOString(),
    });
    patchBackfillProgress("ws-1", { processed: 40, rulesStored: 38, batchStored: 2, remaining: 60 });
    const mid = getBackfillProgress("ws-1", "client-1");
    expect(mid?.processed).toBe(40);
    expect(mid?.remaining).toBe(60);

    patchBackfillProgress("ws-1", { phase: "done", notice: "Summary updated." });
    expect(getBackfillProgress("ws-1")?.phase).toBe("done");
    expect(getBackfillProgress("ws-1", "other-client")).toBeNull();
    clearBackfillProgress("ws-1");
    expect(getBackfillProgress("ws-1")).toBeNull();
  });

  it("lets only one active run own a workspace", () => {
    const start = {
      clientId: "client-1",
      pendingBefore: 0,
      processed: 0,
      rulesStored: 0,
      batchStored: 0,
      remaining: 0,
      notice: null,
      startedAt: new Date().toISOString(),
    } as const;
    expect(tryStartBackfill("ws-2", { ...start, phase: "extracting" })).toBe(true);
    // A second tab or click cannot start a competing run.
    expect(tryStartBackfill("ws-2", { ...start, phase: "extracting" })).toBe(false);
    expect(getBackfillProgress("ws-2")?.phase).toBe("extracting");
    // Once finished, a new run may start.
    patchBackfillProgress("ws-2", { phase: "done" });
    expect(tryStartBackfill("ws-2", { ...start, phase: "extracting" })).toBe(true);
    clearBackfillProgress("ws-2");
  });
});
