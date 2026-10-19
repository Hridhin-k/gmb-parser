import { describe, expect, it } from "vitest";
import {
  ACTION_STATUS,
  PAGE_LOADING,
  SCOPE_REFRESH,
  explainFailure,
  failureKindFromStatus,
} from "@/lib/ui-status";

describe("ui-status copy", () => {
  it("keeps page and refresh messages specific and non-generic", () => {
    expect(PAGE_LOADING.overview.title).toMatch(/overview/i);
    expect(PAGE_LOADING.reviews.detail).toMatch(/inbox|reviews/i);
    expect(SCOPE_REFRESH.analytics.short).toMatch(/recalculat|calculat/i);
    expect(ACTION_STATUS.aiDraft.detail).toMatch(/guidelines/i);
    expect(ACTION_STATUS.aiDraft.detail).not.toMatch(/trained/i);
  });

  it("maps HTTP status codes to failure kinds", () => {
    expect(failureKindFromStatus(403)).toBe("forbidden");
    expect(failureKindFromStatus(504)).toBe("timeout");
    expect(failureKindFromStatus(503)).toBe("unavailable");
    expect(failureKindFromStatus(500)).toBe("generic");
  });

  it("explains failures without inventing progress", () => {
    const draft = explainFailure("aiDraft");
    expect(draft.title).toMatch(/couldn't be generated/i);
    expect(draft.detail).toMatch(/preserved/i);
    expect(draft.canRetry).toBe(true);

    const forbidden = explainFailure("forbidden");
    expect(forbidden.canRetry).toBe(false);

    const sync = explainFailure("sync", "Google returned 429");
    expect(sync.detail).toContain("429");
  });

  it("never claims fake percentages in action copy", () => {
    const blob = Object.values(ACTION_STATUS)
      .map((row) => `${row.title} ${row.detail} ${row.short}`)
      .join(" ");
    expect(blob).not.toMatch(/\d+%/);
    expect(blob).not.toMatch(/\bETA\b|remaining minutes/i);
  });
});
