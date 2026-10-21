import { describe, expect, it } from "vitest";
import { applyOrgSummaryUpdate, emptyOrgSummary, mergeOrgSummary, ORG_SUMMARY_LOGIC_VERSION, projectOrgSummary } from "@/lib/intelligence/org-summary";
import type { SummaryReview } from "@/lib/intelligence/summary-aggregate";
import type { SummaryWindow } from "@/lib/intelligence/summary-window";

function review(overrides: Partial<SummaryReview> & { id: string }): SummaryReview {
  return {
    locationId: "loc-1",
    stars: 5,
    createdAt: "2026-10-10T10:00:00.000Z",
    contentHash: `hash-${overrides.id}`,
    overall: "positive",
    topics: ["staff_politeness"],
    issues: [],
    praise: ["staff_politeness"],
    excerpts: [],
    ...overrides,
  };
}

const ALL_TIME: SummaryWindow = {
  kind: "all",
  start: null,
  end: null,
  timezone: "Asia/Kolkata",
  label: "All time",
  comparison: null,
};

describe("organisation summary merge", () => {
  it("adds new reviews incrementally and skips unchanged ones", () => {
    const first = mergeOrgSummary(emptyOrgSummary("client-1"), [
      review({ id: "a" }),
      review({ id: "b", stars: 2, overall: "negative", topics: ["parking"], issues: ["parking"], praise: [] }),
    ]);
    expect(first.added).toBe(2);
    expect(first.state.days["loc-1|2026-10-10"]?.reviewCount).toBe(2);

    const second = mergeOrgSummary(first.state, [
      review({ id: "a" }),
      review({ id: "b", stars: 2, overall: "negative", topics: ["parking"], issues: ["parking"], praise: [] }),
    ]);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.state.days["loc-1|2026-10-10"]?.reviewCount).toBe(2);
  });

  it("replaces a changed review instead of double counting it", () => {
    const first = mergeOrgSummary(emptyOrgSummary("client-1"), [review({ id: "a", stars: 5 })]);
    const changed = mergeOrgSummary(first.state, [
      review({ id: "a", stars: 1, contentHash: "hash-a2", overall: "negative", topics: ["parking"], issues: ["parking"], praise: [] }),
    ]);
    expect(changed.updated).toBe(1);
    const projection = projectOrgSummary(changed.state, { locationIds: ["loc-1"], window: ALL_TIME });
    expect(projection?.coverage.reviewCount).toBe(1);
    expect(projection?.metrics.averageRating).toBe(1);
    expect(projection?.praise).toHaveLength(0);
    expect(projection?.issues[0]?.code).toBe("parking");
  });

  it("rebuilds from the current readings until extraction finishes, then merges only changes", () => {
    const stale = mergeOrgSummary(emptyOrgSummary("client-1"), [
      review({ id: "a", stars: 5, topics: ["staff_politeness"], praise: ["staff_politeness"], issues: [] }),
    ]);
    const current = [
      review({ id: "a", stars: 2, overall: "negative", topics: ["product_variety"], issues: ["product_variety"], praise: [] }),
    ];
    const partial = applyOrgSummaryUpdate(stale.state, "client-1", current, false);
    expect(partial.rewritten).toBe(true);
    expect(partial.settled).toBe(false);
    expect(partial.state.logicVersion).toBeUndefined();
    expect(projectOrgSummary(partial.state, { locationIds: ["loc-1"], window: ALL_TIME })?.issues[0]?.code).toBe("product_variety");

    const finished = applyOrgSummaryUpdate(partial.state, "client-1", current, true);
    expect(finished.rewritten).toBe(true);
    expect(finished.state.logicVersion).toBe(ORG_SUMMARY_LOGIC_VERSION);

    const later = applyOrgSummaryUpdate(finished.state, "client-1", [
      ...current,
      review({ id: "b", stars: 1, overall: "negative", topics: ["price"], issues: ["price"], praise: [] }),
    ], true);
    expect(later.rewritten).toBe(false);
    expect(later.added).toBe(1);
    expect(later.skipped).toBe(1);
    expect(projectOrgSummary(later.state, { locationIds: ["loc-1"], window: ALL_TIME })?.coverage.reviewCount).toBe(2);
  });

  it("discards a summary from another window and rebuilds the requested months", () => {
    const old = applyOrgSummaryUpdate(
      null,
      "client-1",
      [review({ id: "old", stars: 5, topics: ["staff_politeness"], praise: ["staff_politeness"], issues: [] })],
      true
    );
    expect(old.state.logicVersion).toBe(ORG_SUMMARY_LOGIC_VERSION);
    const current = [
      review({ id: "recent", stars: 2, overall: "negative", topics: ["product_variety"], issues: ["product_variety"], praise: [] }),
    ];
    const partial = applyOrgSummaryUpdate(old.state, "client-1", current, false, 6);
    expect(partial.rewritten).toBe(true);
    expect(partial.settled).toBe(false);
    expect(partial.state.logicVersion).toBeUndefined();
    expect(partial.state.windowMonths).toBeUndefined();
    expect(partial.state.contributions.old).toBeUndefined();
    expect(projectOrgSummary(partial.state, { locationIds: ["loc-1"], window: ALL_TIME })?.coverage.reviewCount).toBe(1);

    const finished = applyOrgSummaryUpdate(partial.state, "client-1", current, true, 6);
    expect(finished.rewritten).toBe(true);
    expect(finished.state.windowMonths).toBe(6);
    expect(finished.state.logicVersion).toBe(ORG_SUMMARY_LOGIC_VERSION);

    const next = applyOrgSummaryUpdate(finished.state, "client-1", current, true, 6);
    expect(next.rewritten).toBe(false);
    expect(next.skipped).toBe(1);
  });

  it("subtracts reviews that disappear", () => {
    const first = mergeOrgSummary(emptyOrgSummary("client-1"), [review({ id: "a" }), review({ id: "b" })]);
    const afterDelete = mergeOrgSummary(first.state, [review({ id: "a" })]);
    expect(afterDelete.removed).toBe(1);
    expect(projectOrgSummary(afterDelete.state, { locationIds: ["loc-1"], window: ALL_TIME })?.coverage.reviewCount).toBe(1);
  });

  it("slices any scope and window from the one organisation store", () => {
    const merged = mergeOrgSummary(emptyOrgSummary("client-1"), [
      review({ id: "a", createdAt: "2026-10-10T10:00:00.000Z" }),
      review({ id: "b", createdAt: "2026-07-01T10:00:00.000Z", locationId: "loc-2" }),
      review({ id: "c", createdAt: "2025-01-01T10:00:00.000Z", stars: 4 }),
    ]);
    const window: SummaryWindow = {
      kind: "bounded",
      start: "2026-04-21T00:00:00.000Z",
      end: "2026-10-21T00:00:00.000Z",
      timezone: "Asia/Kolkata",
      label: "Last 6 months",
      comparison: { start: "2025-10-21T00:00:00.000Z", end: "2026-04-21T00:00:00.000Z" },
    };
    const projection = projectOrgSummary(merged.state, { locationIds: ["loc-1", "loc-2"], window });
    expect(projection?.coverage.reviewCount).toBe(2);
    expect(projection?.changes?.previousReviewCount).toBe(0);
    expect(projection?.locations.find((row) => row.locationId === "loc-2")?.reviewCount).toBe(1);

    const oneOutlet = projectOrgSummary(merged.state, { locationIds: ["loc-2"], window: ALL_TIME });
    expect(oneOutlet?.coverage.reviewCount).toBe(1);
    expect(oneOutlet?.coverage.locationCount).toBe(1);
  });

  it("returns null when the store has nothing for the scope", () => {
    const merged = mergeOrgSummary(emptyOrgSummary("client-1"), [review({ id: "a" })]);
    expect(projectOrgSummary(merged.state, { locationIds: ["loc-9"], window: ALL_TIME })).toBeNull();
  });
});
