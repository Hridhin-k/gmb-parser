import { describe, expect, it } from "vitest";
import { canAct } from "@/lib/access";
import { inReviewWindow } from "@/lib/analytics-metrics";
import { parseDateRange } from "@/lib/date-range";
import { closesWhenReplyPublished, escalationVisibleInScope } from "@/lib/escalations";
import { groupIdsInScope, locationInGroup } from "@/lib/hierarchy";
import { average, reviewDrillHref } from "@/lib/metrics";
import { overviewQueryKey } from "@/lib/overview-board";
import {
  readScopeRequest,
  resolveScope,
  UNAVAILABLE_SCOPE_ID,
  visibleCatalog,
  writeScopeParams,
  type ScopeCatalog,
  type ScopeRequest,
} from "@/lib/scope";
import { scopedHref } from "@/lib/shell";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const HARBOUR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MARKET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NORTH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EAST = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PIER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DOCK = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const STALL = "12121212-1212-4121-8121-121212121212";
const FOREIGN = "abababab-abab-4aba-8aba-abababababab";

const groups = [
  { id: NORTH, parentId: null },
  { id: EAST, parentId: NORTH },
];

interface Place {
  id: string;
  clientId: string;
  groupId: string | null;
}

interface Review {
  id: string;
  locationId: string;
  stars: number;
  at: string;
  replyStatus: "none" | "published";
}

interface CaseRow {
  id: string;
  reviewId: string;
  status: "needs_human" | "resolved";
}

const openLock = { clientId: null, groupId: null, locationId: null };
const emptyRequest: ScopeRequest = { clientId: "", groupId: "", locationId: "" };

function catalog(lock: ScopeCatalog["lock"], places: Place[]): ScopeCatalog {
  return visibleCatalog({
    workspaceId: WORKSPACE,
    workspaceName: "Workspace",
    clients: [
      { id: HARBOUR, name: "Harbour" },
      { id: MARKET, name: "Market" },
    ],
    groups: [
      { id: NORTH, name: "North", clientId: HARBOUR, parentId: null },
      { id: EAST, name: "East", clientId: HARBOUR, parentId: NORTH },
    ],
    locations: places.map((place) => ({
      id: place.id,
      name: place.id,
      clientId: place.clientId,
      groupId: place.groupId,
    })),
    lock,
  });
}

const places: Place[] = [
  { id: PIER, clientId: HARBOUR, groupId: NORTH },
  { id: DOCK, clientId: HARBOUR, groupId: EAST },
  { id: STALL, clientId: MARKET, groupId: null },
];

const reviews: Review[] = [
  { id: "r1", locationId: PIER, stars: 5, at: "2026-01-02T00:00:00.000Z", replyStatus: "none" },
  { id: "r2", locationId: DOCK, stars: 2, at: "2026-01-15T00:00:00.000Z", replyStatus: "none" },
  { id: "r3", locationId: DOCK, stars: 4, at: "2026-02-01T00:00:00.000Z", replyStatus: "published" },
  { id: "r4", locationId: STALL, stars: 1, at: "2026-01-10T00:00:00.000Z", replyStatus: "none" },
];

const cases: CaseRow[] = [
  { id: "c1", reviewId: "r2", status: "needs_human" },
  { id: "c2", reviewId: "r4", status: "needs_human" },
];

function idsFor(request: ScopeRequest, rows = places) {
  return resolveScope(catalog(openLock, rows), request).locationIds;
}

function inScopeReviews(locationIds: string[], start: string | null, end: string | null, rows = reviews) {
  const allowed = new Set(locationIds);
  return rows.filter((review) => allowed.has(review.locationId) && inReviewWindow(review.at, start, end));
}

function totals(rows: Review[]) {
  const ratingSum = rows.reduce((sum, review) => sum + review.stars, 0);
  return { count: rows.length, ratingSum, average: average(ratingSum, rows.length) };
}

describe("one scope across overview, inbox, escalations, analytics, and insights", () => {
  const range = parseDateRange({ range: "custom", from: "2026-01-01", to: "2026-01-31" }, "all");

  it("makes the organisation the sum of its locations, with each review counted once", () => {
    const locationIds = idsFor({ ...emptyRequest, clientId: HARBOUR });
    const rows = inScopeReviews(locationIds, range.start?.toISOString() ?? null, range.end?.toISOString() ?? null);
    const combined = totals(rows);
    const byLocation = locationIds.map((id) => totals(rows.filter((review) => review.locationId === id)));
    expect(locationIds).toEqual([PIER, DOCK]);
    expect(combined.count).toBe(byLocation.reduce((sum, row) => sum + row.count, 0));
    expect(combined.ratingSum).toBe(byLocation.reduce((sum, row) => sum + row.ratingSum, 0));
    expect(combined.average).toBe(7 / 2);
    expect(rows.map((review) => review.id)).toEqual(["r1", "r2"]);
  });

  it("keeps a group to its members, including a city, and leaves the other organisation out", () => {
    const locationIds = idsFor({ ...emptyRequest, groupId: NORTH });
    expect(locationIds.sort()).toEqual([DOCK, PIER].sort());
    expect(groupIdsInScope(NORTH, groups)).toEqual([NORTH, EAST]);
    expect(locationInGroup(EAST, NORTH, groups)).toBe(true);
    expect(locationInGroup(null, NORTH, groups)).toBe(false);
    const rows = inScopeReviews(locationIds, null, null);
    expect(rows).toHaveLength(3);
    expect(rows.some((review) => review.locationId === STALL)).toBe(false);
    expect(new Set(rows.map((review) => review.id)).size).toBe(rows.length);
  });

  it("matches one outlet and only that outlet", () => {
    const locationIds = idsFor({ ...emptyRequest, locationId: DOCK });
    const rows = inScopeReviews(locationIds, null, null);
    expect(locationIds).toEqual([DOCK]);
    expect(totals(rows)).toMatchObject({ count: 2, ratingSum: 6, average: 3 });
  });

  it("moves a location between groups without changing the organisation total", () => {
    const before = idsFor({ ...emptyRequest, groupId: NORTH });
    const moved = places.map((place) => (place.id === DOCK ? { ...place, groupId: null } : place));
    const after = idsFor({ ...emptyRequest, groupId: NORTH }, moved);
    const organisation = idsFor({ ...emptyRequest, clientId: HARBOUR }, moved);
    expect(before).toContain(DOCK);
    expect(after).not.toContain(DOCK);
    expect(organisation.sort()).toEqual([DOCK, PIER].sort());
    expect(inScopeReviews(organisation, null, null)).toHaveLength(3);
  });

  it("keeps an escalation on the review's location, and a reply does not close it", () => {
    const groupIds = groupIdsInScope(NORTH, groups);
    const dockReview = reviews.find((review) => review.id === "r2")!;
    const visible = cases.filter((row) => {
      const review = reviews.find((item) => item.id === row.reviewId)!;
      const place = places.find((item) => item.id === review.locationId)!;
      return escalationVisibleInScope({
        caseClientId: place.clientId,
        caseGroupId: place.groupId,
        caseLocationId: place.id,
        scope: { clientId: HARBOUR, groupId: NORTH, locationId: null, groupIds },
      });
    });
    expect(visible.map((row) => row.id)).toEqual(["c1"]);
    expect(dockReview.locationId).toBe(DOCK);
    const afterReply = reviews.map((review) =>
      review.id === dockReview.id ? { ...review, replyStatus: "published" as const } : review
    );
    expect(closesWhenReplyPublished()).toBe(false);
    expect(afterReply.find((review) => review.id === dockReview.id)?.replyStatus).toBe("published");
    expect(afterReply.filter((review) => review.replyStatus === "none").map((review) => review.id)).not.toContain(dockReview.id);
    expect(cases.find((row) => row.reviewId === dockReview.id)?.status).toBe("needs_human");
  });

  it("excludes a review on the end boundary of the selected window", () => {
    expect(inReviewWindow("2026-02-01T00:00:00.000Z", range.start?.toISOString() ?? null, range.end?.toISOString() ?? null)).toBe(false);
  });
});

describe("navigation keeps the same scope", () => {
  const current = new URLSearchParams(`client=${HARBOUR}&group=${NORTH}&location=${PIER}&range=12m&rating=2&filter=draft`);

  it("copies organisation, group, and outlet onto every review screen", () => {
    for (const path of ["/overview", "/reviews", "/escalations", "/analytics", "/insights", "/reports"]) {
      const href = scopedHref(path, current, "/overview");
      const params = new URL(href, "http://localhost").searchParams;
      expect(params.get("client")).toBe(HARBOUR);
      expect(params.get("group")).toBe(NORTH);
      expect(params.get("location")).toBe(PIER);
      expect(params.get("rating")).toBeNull();
    }
  });

  it("opens the reviews behind a rating with the same scope and dates", () => {
    const href = reviewDrillHref(parseDateRange({ range: "12m" }, "12m"), {
      clientId: HARBOUR,
      groupId: NORTH,
      locationId: PIER,
    }, { stars: "low" });
    const params = new URL(href, "http://localhost").searchParams;
    expect(params.get("client")).toBe(HARBOUR);
    expect(params.get("group")).toBe(NORTH);
    expect(params.get("location")).toBe(PIER);
    expect(params.get("stars")).toBe("low");
    expect(params.get("range")).toBe("12m");
  });

  it("round-trips a deep link and drops an invalid id", () => {
    const params = new URLSearchParams();
    writeScopeParams(params, { clientId: HARBOUR, groupId: NORTH, locationId: null });
    params.set("range", "6m");
    const request = readScopeRequest({
      client: params.get("client") ?? undefined,
      group: params.get("group") ?? undefined,
      location: "not-a-uuid",
    });
    expect(request.locationId).toBe("");
    const unknown = resolveScope(catalog(openLock, places), { ...request, locationId: FOREIGN });
    expect(unknown.dropped).toBe(true);
    expect(unknown.locationIds).not.toContain(FOREIGN);
    expect(unknown.locationIds.sort()).toEqual([DOCK, PIER].sort());
    expect(overviewQueryKey((key) => params.get(key))).toBe(`${HARBOUR}|${NORTH}||6m||`);
  });
});

describe("the selector cannot widen access", () => {
  it("drops another organisation and another tenant", () => {
    const locked = catalog({ clientId: HARBOUR, groupId: null, locationId: null }, places);
    const scope = resolveScope(locked, { ...emptyRequest, clientId: MARKET, locationId: STALL });
    expect(scope.locationIds).not.toContain(STALL);
    expect(scope.locationIds).not.toContain(FOREIGN);
    expect(scope.clientId).toBe(HARBOUR);
  });

  it("matches nothing when the saved place is gone, instead of every location", () => {
    const locked = catalog({ clientId: null, groupId: null, locationId: FOREIGN }, places);
    const scope = resolveScope(locked, emptyRequest);
    expect(scope.blocked).toBe(true);
    expect(scope.locationIds).toEqual([]);
    expect(scope.clientId).toBe(UNAVAILABLE_SCOPE_ID);
    expect(scope.clientId).not.toBeNull();
  });

  it("refuses a store manager acting on another outlet or another workspace", () => {
    const resource = { workspaceId: WORKSPACE, clientId: HARBOUR, groupId: NORTH, locationId: DOCK };
    expect(
      canAct({
        role: "store_manager",
        enabled: true,
        permission: "draft",
        scope: { clientId: null, groupId: null, locationId: PIER },
        actorWorkspaceId: WORKSPACE,
        resource,
      })
    ).toBe(false);
    expect(
      canAct({
        role: "owner",
        enabled: true,
        permission: "draft",
        scope: openLock,
        actorWorkspaceId: OTHER_WORKSPACE,
        resource,
      })
    ).toBe(false);
  });
});
