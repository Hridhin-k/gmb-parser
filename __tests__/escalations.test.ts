import { describe, expect, it } from "vitest";
import {
  DEFAULT_ESCALATION_POLICY,
  autoreplyPausedFor,
  closesWhenReplyPublished,
  escalationReasons,
  escalationVisibleInScope,
  nextEscalationLevel,
  overdueStep,
  planAssignment,
  planLevelOwner,
  queueBucket,
  reassignmentError,
  shouldSkipTrigger,
  slaClock,
  type AssignmentLocation,
  type AssignmentMember,
} from "@/lib/escalations";

describe("escalation rules", () => {
  it("flags three stars and below by default", () => {
    expect(escalationReasons({ starRating: 3, comment: "Slow service" }, DEFAULT_ESCALATION_POLICY)).toContain(
      "rating"
    );
    expect(escalationReasons({ starRating: 4, comment: "Good" }, DEFAULT_ESCALATION_POLICY)).toEqual([]);
  });

  it("flags profanity and legal wording on a high-star review", () => {
    expect(
      escalationReasons({ starRating: 5, comment: "This is shit" }, DEFAULT_ESCALATION_POLICY)
    ).toContain("profanity");
    expect(
      escalationReasons({ starRating: 5, comment: "I will call the police" }, DEFAULT_ESCALATION_POLICY)
    ).toContain("legal_safety");
  });

  it("uses a configured keyword and a higher star threshold", () => {
    const policy = { ...DEFAULT_ESCALATION_POLICY, maxStars: 2, extraKeywords: ["mould"] };
    expect(escalationReasons({ starRating: 3, comment: "Fine" }, policy)).toEqual([]);
    expect(escalationReasons({ starRating: 5, comment: "There was mould" }, policy)).toEqual(["keyword"]);
  });

  it("does not open a second record for the same trigger", () => {
    expect(shouldSkipTrigger({ hasOpen: true, knownKey: false })).toBe(true);
    expect(shouldSkipTrigger({ hasOpen: false, knownKey: true })).toBe(true);
    expect(shouldSkipTrigger({ hasOpen: false, knownKey: false })).toBe(false);
  });
});

describe("SLA clock", () => {
  const due = "2026-10-16T12:00:00.000Z";

  it("splits the queue into needs human, in progress, past SLA, and resolved", () => {
    const now = Date.parse("2026-10-16T10:00:00.000Z");
    expect(queueBucket({ status: "needs_human", dueAt: due }, now)).toBe("needs_human");
    expect(queueBucket({ status: "in_progress", dueAt: due }, now)).toBe("in_progress");
    expect(queueBucket({ status: "in_progress", dueAt: "2026-10-16T09:00:00.000Z" }, now)).toBe("past_sla");
    expect(queueBucket({ status: "resolved", dueAt: "2026-10-16T09:00:00.000Z" }, now)).toBe("resolved");
  });

  it("shows remaining time and overdue duration from the stored due timestamp", () => {
    expect(slaClock(due, Date.parse("2026-10-16T10:00:00.000Z"))).toEqual({
      remaining: "2h 0m",
      overdue: null,
    });
    expect(slaClock(due, Date.parse("2026-10-16T13:30:00.000Z"))).toEqual({
      remaining: null,
      overdue: "1h 30m",
    });
  });
});

const location: AssignmentLocation = {
  workspaceId: "ws",
  clientId: "org-a",
  groupId: "city",
  parentGroupId: "region",
  locationId: "outlet",
};

function member(partial: Partial<AssignmentMember> & Pick<AssignmentMember, "userId" | "role">): AssignmentMember {
  return {
    enabled: true,
    scope: { clientId: null, groupId: null, locationId: null },
    ...partial,
  };
}

describe("automatic assignment", () => {
  const manager = member({ userId: "manager", role: "store_manager", scope: { clientId: null, groupId: null, locationId: "outlet" } });
  const owner = member({ userId: "owner", role: "owner" });
  const otherOrg = member({
    userId: "other",
    role: "brand_manager",
    scope: { clientId: "org-b", groupId: null, locationId: null },
  });

  it("assigns the active location manager and keeps them as the responsible manager", () => {
    expect(planAssignment({ locationManagerId: "manager", members: [manager, owner], location })).toEqual({
      responsibleUserId: "manager",
      assigneeId: "manager",
      ownership: "manager",
      reason: "location_manager",
    });
  });

  it("uses an administrator when the manager is missing, inactive, or outside this location", () => {
    expect(planAssignment({ locationManagerId: null, members: [owner], location }).reason).toBe("manager_missing");
    expect(
      planAssignment({
        locationManagerId: "manager",
        members: [{ ...manager, enabled: false }, owner],
        location,
      })
    ).toMatchObject({ assigneeId: "owner", ownership: "fallback", reason: "manager_inactive", responsibleUserId: "manager" });
    expect(planAssignment({ locationManagerId: "manager", members: [otherOrg, owner], location })).toMatchObject({
      assigneeId: "owner",
      reason: "manager_unauthorised",
      responsibleUserId: "manager",
    });
  });

  it("leaves the assignee empty only when no administrator can see the location", () => {
    expect(planAssignment({ locationManagerId: null, members: [otherOrg], location })).toMatchObject({
      assigneeId: null,
      ownership: "fallback",
      reason: "no_administrator",
    });
  });
});

describe("reassignment", () => {
  const locationManager = member({ userId: "manager", role: "store_manager", scope: { clientId: null, groupId: null, locationId: "outlet" } });
  const regional = member({ userId: "regional", role: "group_manager", scope: { clientId: null, groupId: "region", locationId: null } });
  const outsider = member({ userId: "outsider", role: "store_manager", scope: { clientId: "org-b", groupId: null, locationId: null } });
  const base = {
    actorCanAssign: true,
    location,
    reason: "Covering a day off",
    currentUpdatedAt: "2026-10-19T10:00:00.000Z",
    expectedUpdatedAt: "2026-10-19T10:00:00.000Z",
  };

  it("allows another manager whose scope includes this location", () => {
    expect(reassignmentError({ ...base, target: regional })).toBeNull();
  });

  it("rejects a stale case, a missing reason, an inactive person, another organisation, and an unauthorised actor", () => {
    expect(reassignmentError({ ...base, expectedUpdatedAt: "2026-10-19T09:00:00.000Z", target: regional })).toMatch(/Refresh/);
    expect(reassignmentError({ ...base, reason: "no", target: regional })).toMatch(/reason/);
    expect(reassignmentError({ ...base, target: { ...locationManager, enabled: false } })).toMatch(/not active/);
    expect(reassignmentError({ ...base, target: outsider })).toMatch(/cannot take cases/);
    expect(reassignmentError({ ...base, actorCanAssign: false, target: regional })).toMatch(/permission/);
    expect(reassignmentError({ ...base, target: null })).toMatch(/not in this workspace/);
  });
});

describe("SLA progression", () => {
  const now = "2026-10-19T12:00:00.000Z";
  const due = "2026-10-19T10:00:00.000Z";

  it("moves one level when the claim succeeds and ignores a retry or a future deadline", () => {
    expect(nextEscalationLevel("store")).toBe("regional");
    expect(nextEscalationLevel("regional")).toBe("leadership");
    expect(nextEscalationLevel("leadership")).toBeNull();
    expect(overdueStep({ status: "in_progress", level: "store", dueAt: due, now, claimed: true })).toBe("advance");
    expect(overdueStep({ status: "in_progress", level: "store", dueAt: due, now, claimed: false })).toBe("skip");
    expect(overdueStep({ status: "in_progress", level: "store", dueAt: "2026-10-19T13:00:00.000Z", now, claimed: true })).toBe("wait");
    expect(overdueStep({ status: "resolved", level: "store", dueAt: due, now, claimed: true })).toBe("skip");
    expect(overdueStep({ status: "in_progress", level: "leadership", dueAt: due, now, claimed: true })).toBe("note");
  });

  it("keeps the current owner when the next level has nobody for this location", () => {
    expect(planLevelOwner("regional", [], location, "manager")).toBe("manager");
    expect(
      planLevelOwner(
        "leadership",
        [member({ userId: "owner", role: "owner" })],
        location,
        "manager"
      )
    ).toBe("owner");
  });

  it("does not close a case because a public reply was published", () => {
    expect(closesWhenReplyPublished()).toBe(false);
  });
});

describe("escalation scope", () => {
  const row = { caseClientId: "org-a", caseGroupId: "city", caseLocationId: "outlet" };

  it("keeps organisation, group, and location queues on the locations they contain", () => {
    expect(escalationVisibleInScope({ ...row, scope: { clientId: "org-a", groupId: null, locationId: null, groupIds: [] } })).toBe(true);
    expect(escalationVisibleInScope({ ...row, scope: { clientId: "org-b", groupId: null, locationId: null, groupIds: [] } })).toBe(false);
    expect(
      escalationVisibleInScope({ ...row, scope: { clientId: null, groupId: "region", locationId: null, groupIds: ["region", "city"] } })
    ).toBe(true);
    expect(
      escalationVisibleInScope({ ...row, scope: { clientId: null, groupId: "other", locationId: null, groupIds: ["other"] } })
    ).toBe(false);
    expect(
      escalationVisibleInScope({ ...row, scope: { clientId: null, groupId: null, locationId: "outlet", groupIds: [] } })
    ).toBe(true);
    expect(
      escalationVisibleInScope({ ...row, scope: { clientId: null, groupId: null, locationId: "elsewhere", groupIds: [] } })
    ).toBe(false);
  });
});

describe("autoreply pause", () => {
  const pauses = [
    { scope: "location", clientId: null, locationId: "loc-1" },
    { scope: "client", clientId: "client-1", locationId: null },
  ];

  it("blocks the paused location and client, and leaves other locations alone", () => {
    expect(autoreplyPausedFor({ pauses, clientId: null, locationId: "loc-1" })).toBe(true);
    expect(autoreplyPausedFor({ pauses, clientId: "client-1", locationId: "loc-2" })).toBe(true);
    expect(autoreplyPausedFor({ pauses, clientId: "client-2", locationId: "loc-2" })).toBe(false);
  });
});
