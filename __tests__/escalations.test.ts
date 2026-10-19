import { describe, expect, it } from "vitest";
import {
  DEFAULT_ESCALATION_POLICY,
  autoreplyPausedFor,
  escalationReasons,
  queueBucket,
  shouldSkipTrigger,
  slaClock,
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
