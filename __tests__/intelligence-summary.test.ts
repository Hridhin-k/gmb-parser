import { describe, expect, it } from "vitest";
import { parseDateRange } from "@/lib/date-range";
import { membershipHash, summaryIdentityKey } from "@/lib/intelligence/identity";
import {
  beginSummaryJob,
  buildSummaryDocument,
  reviewTouchesSummary,
  staleForMembership,
  summaryIdentityFor,
  summaryNarrative,
  summaryReuse,
  summarySourceHash,
  type SummaryReview,
} from "@/lib/intelligence/summary-aggregate";
import { authorizeSummaryScope, SummaryAccessError } from "@/lib/intelligence/summary-scope";
import { summaryMonth, summaryWindow, windowContains } from "@/lib/intelligence/summary-window";
import type { ScopeCatalog } from "@/lib/scope";

const workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const client = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const group = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const otherGroup = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const locationA = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const locationB = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const foreign = "11111111-1111-1111-1111-111111111111";

function catalog(lock: ScopeCatalog["lock"]): ScopeCatalog {
  return {
    workspaceId: workspace,
    workspaceName: "Workspace",
    clients: [{ id: client, name: "North" }],
    groups: [
      { id: group, name: "City", clientId: client, parentId: null },
      { id: otherGroup, name: "Other", clientId: client, parentId: null },
    ],
    locations: [
      { id: locationA, name: "Outlet A", clientId: client, groupId: group },
      { id: locationB, name: "Outlet B", clientId: client, groupId: otherGroup },
    ],
    lock,
  };
}

function review(partial: Partial<SummaryReview> & Pick<SummaryReview, "id" | "createdAt" | "stars">): SummaryReview {
  return {
    locationId: locationA,
    contentHash: partial.id,
    overall: "negative",
    topics: [],
    issues: [],
    praise: [],
    excerpts: [],
    ...partial,
  };
}

const open = { clientId: null, groupId: null, locationId: null };

describe("summary scope and windows", () => {
  it("keeps all-time, 12-month, and custom windows as different identities", () => {
    const now = new Date("2026-10-20T15:00:00.000Z");
    const scope = authorizeSummaryScope(catalog(open), { clientId: client, groupId: "", locationId: "" });
    const all = summaryWindow(parseDateRange({ range: "all" }, "all", now), "Asia/Kolkata", now);
    const year = summaryWindow(parseDateRange({ range: "12m" }, "all", now), "Asia/Kolkata", now);
    const custom = summaryWindow(parseDateRange({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, "all", now), "UTC", now);
    const keys = [all, year, custom].map((window) => summaryIdentityKey(summaryIdentityFor(scope, window)));
    expect(new Set(keys).size).toBe(3);
    expect(all.kind).toBe("all");
    expect(year.start).toBe("2025-10-21T00:00:00.000Z");
    expect(year.end).toBe("2026-10-21T00:00:00.000Z");
    expect(summaryWindow(parseDateRange({ range: "12m" }, "all", now), "Asia/Kolkata", now).start).toBe(year.start);
    const tomorrow = summaryWindow(parseDateRange({ range: "12m" }, "all", new Date("2026-10-21T01:00:00.000Z")), "Asia/Kolkata", new Date("2026-10-21T01:00:00.000Z"));
    expect(tomorrow.start).not.toBe(year.start);
    expect(year.comparison).toEqual({ start: "2024-10-21T00:00:00.000Z", end: "2025-10-21T00:00:00.000Z" });
    expect(custom.start).toBe("2026-01-01T00:00:00.000Z");
    expect(custom.end).toBe("2026-04-01T00:00:00.000Z");
  });

  it("refuses a location, group, or organisation the member cannot see", () => {
    expect(() => authorizeSummaryScope(catalog({ clientId: null, groupId: null, locationId: locationA }), { clientId: client, groupId: "", locationId: locationB })).toThrow(SummaryAccessError);
    expect(() => authorizeSummaryScope(catalog(open), { clientId: foreign, groupId: "", locationId: "" })).toThrow(SummaryAccessError);
    const outlet = authorizeSummaryScope(catalog({ clientId: null, groupId: null, locationId: locationA }), { clientId: "", groupId: "", locationId: "" });
    expect(outlet.scopeType).toBe("location");
    expect(outlet.scopeId).toBe(locationA);
    const city = authorizeSummaryScope(catalog(open), { clientId: client, groupId: group, locationId: "" });
    expect(city.scopeType).toBe("group");
    expect(city.locationIds).toEqual([locationA]);
    expect(city.membershipHash).toBe(membershipHash([locationA]));
  });
});

describe("summary aggregates", () => {
  const window = summaryWindow(parseDateRange({ range: "custom", from: "2026-08-01", to: "2026-08-31" }, "all"), "Asia/Kolkata");
  const overlap = summaryWindow(parseDateRange({ range: "custom", from: "2026-08-15", to: "2026-09-15" }, "all"), "Asia/Kolkata");

  it("counts a review once, weights the rating by reviews, and keeps empty averages null", () => {
    const reviews = [
      review({ id: "r1", createdAt: "2026-08-02T00:00:00.000Z", stars: 5, locationId: locationA, topics: ["cleanliness", "fitting_room"], issues: ["cleanliness", "fitting_room"], excerpts: [{ topicCode: "cleanliness", polarity: "complaint", text: "The trial room was dirty." }] }),
      review({ id: "r1", createdAt: "2026-08-02T00:00:00.000Z", stars: 1, locationId: locationA }),
      review({ id: "r2", createdAt: "2026-08-03T00:00:00.000Z", stars: 1, locationId: locationB, overall: "unknown" }),
      review({ id: "r3", createdAt: "2026-08-04T00:00:00.000Z", stars: 1, locationId: locationB, overall: null }),
      review({ id: "r4", createdAt: null, stars: 1, locationId: locationA }),
      review({ id: "r5", createdAt: "2026-09-02T00:00:00.000Z", stars: 5, locationId: locationA }),
    ];
    const document = buildSummaryDocument({
      scopeType: "organisation",
      scopeId: client,
      locationIds: [locationA, locationB],
      window,
      reviews,
      previousReviews: [review({ id: "old", createdAt: "2026-07-02T00:00:00.000Z", stars: 4, locationId: locationA })],
    });
    expect(document.coverage.reviewCount).toBe(3);
    expect(document.coverage.undatedCount).toBe(1);
    expect(document.coverage.unextractedCount).toBe(1);
    expect(document.metrics.averageRating).toBe(2.3333);
    expect(document.locations.find((location) => location.locationId === locationB)?.reviewCount).toBe(2);
    expect(document.metrics.averageRating).not.toBe(3);
    const empty = buildSummaryDocument({
      scopeType: "location",
      scopeId: locationB,
      locationIds: [locationB],
      window,
      reviews: [],
    });
    expect(empty.coverage.reviewCount).toBe(0);
    expect(empty.metrics.averageRating).toBeNull();
    expect(empty.metrics.negativeShare).toBeNull();
    expect(summaryNarrative(empty)).toBe("No reviews in this window.");
    expect(document.topics.map((topic) => topic.reviews)).toEqual([1, 1]);
    const one = buildSummaryDocument({
      scopeType: "location",
      scopeId: locationA,
      locationIds: [locationA],
      window,
      reviews: [reviews[0]!],
    });
    expect((one.topics[0]?.share ?? 0) + (one.topics[1]?.share ?? 0)).toBe(2);
    expect(document.sentiment.denominator).toBe(1);
    expect(document.sentiment.unknown).toBe(1);
    expect(document.evidence[0]?.excerpt).toBe("The trial room was dirty.");
    expect(document.changes?.previousReviewCount).toBe(1);
    expect(windowContains(window, "2026-08-20T00:00:00.000Z")).toBe(true);
    expect(windowContains(overlap, "2026-08-20T00:00:00.000Z")).toBe(true);
    expect(windowContains(window, "2026-09-02T00:00:00.000Z")).toBe(false);
    expect(summaryMonth("2026-01-31T20:00:00.000Z", "Asia/Kolkata")).toBe("2026-02");
    expect(summaryNarrative(document).toLowerCase()).not.toMatch(/significant|caused/);
  });

  it("reuses an unchanged summary, separates membership changes, and avoids a second job", () => {
    const reviews = [review({ id: "r1", createdAt: "2026-08-02T00:00:00.000Z", stars: 4 })];
    const hash = summarySourceHash(reviews);
    expect(summaryReuse({ status: "ready", sourceHash: hash }, hash)).toBe("reuse");
    expect(summaryReuse({ status: "stale", sourceHash: hash }, hash)).toBe("refresh");
    expect(summarySourceHash([])).not.toBe(summarySourceHash(reviews));
    const stored = {
      id: "s1",
      locationId: null,
      memberLocationIds: [locationA],
      rangeKind: "bounded" as const,
      rangeStart: window.start,
      rangeEnd: window.end,
      membershipHash: membershipHash([locationA]),
      status: "ready",
    };
    expect(reviewTouchesSummary(stored, { locationId: locationA, createdAt: "2026-08-20T00:00:00.000Z" })).toBe(true);
    expect(reviewTouchesSummary(stored, { locationId: locationA, createdAt: "2026-09-20T00:00:00.000Z" })).toBe(false);
    expect(reviewTouchesSummary({ ...stored, rangeKind: "all", rangeStart: null, rangeEnd: null }, { locationId: locationA, createdAt: "2020-01-01T00:00:00.000Z" })).toBe(true);
    expect(reviewTouchesSummary(overlapRef(stored), { locationId: locationA, createdAt: "2026-08-20T00:00:00.000Z" })).toBe(true);
    expect(staleForMembership([stored], [locationA, locationB])).toEqual(["s1"]);
    expect(staleForMembership([stored], [locationA])).toEqual([]);
    expect(beginSummaryJob([{ sourceHash: "abc", status: "running" }], "abc")).toBe("reuse");
    expect(beginSummaryJob([{ sourceHash: "abc", status: "succeeded" }], "abc")).toBe("start");
  });
});

function overlapRef(stored: {
  id: string;
  locationId: string | null;
  memberLocationIds: string[];
  rangeKind: "bounded";
  rangeStart: string | null;
  rangeEnd: string | null;
  membershipHash: string;
  status: string;
}) {
  const overlap = summaryWindow(parseDateRange({ range: "custom", from: "2026-08-15", to: "2026-09-15" }, "all"), "Asia/Kolkata");
  return { ...stored, id: "s2", rangeStart: overlap.start, rangeEnd: overlap.end };
}
