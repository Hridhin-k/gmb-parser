import { describe, expect, it } from "vitest";
import {
  TO_REPLY_STATUS_OPTIONS,
  activeStatusTab,
  canSendReply,
  defaultPicked,
  followUpsHref,
  inboxNarrowing,
  inboxStatuses,
  isSendable,
  longAge,
  nextOpenId,
  parseFollowUpQueue,
  parseInboxTab,
  replyStage,
  reviewBelongsToTab,
  shortAge,
} from "@/components/reviews-status";
import { adjustmentInstruction } from "@/lib/reply-adjustments";

describe("inbox tabs", () => {
  it("opens To reply by default and honours the tab param", () => {
    expect(parseInboxTab(undefined)).toBe("to-reply");
    expect(parseInboxTab("follow-ups")).toBe("follow-ups");
    expect(parseInboxTab("sent")).toBe("sent");
    expect(parseInboxTab("failed")).toBe("failed");
    expect(parseInboxTab("failed-replies")).toBe("failed");
    expect(parseInboxTab(["sent", "to-reply"])).toBe("sent");
    expect(parseInboxTab("nonsense")).toBe("to-reply");
  });

  it("routes old published and failed links to their own tabs", () => {
    expect(parseInboxTab(undefined, ["published"])).toBe("sent");
    expect(parseInboxTab(undefined, ["failed"])).toBe("failed");
    expect(parseInboxTab(undefined, ["draft"])).toBe("to-reply");
    expect(parseInboxTab(undefined, ["escalated", "failed"])).toBe("to-reply");
    // An explicit tab wins over the status.
    expect(parseInboxTab("to-reply", ["published"])).toBe("to-reply");
    expect(parseInboxTab("to-reply", ["failed"])).toBe("to-reply");
  });

  it("gives failed replies a separate query from the normal queue", () => {
    expect(inboxStatuses("to-reply", [])).toEqual(["unanswered", "draft", "approved"]);
    expect(inboxStatuses("failed", [])).toEqual(["failed"]);
    expect(inboxStatuses("failed", ["draft", "published"])).toEqual(["failed"]);
    expect(inboxStatuses("sent", ["draft"])).toEqual(["published"]);
  });

  it("keeps a narrowing that fits inside To reply and drops one that does not", () => {
    expect(inboxStatuses("to-reply", ["draft", "failed"])).toEqual(["draft"]);
    expect(inboxStatuses("to-reply", ["published"])).toEqual(["unanswered", "draft", "approved"]);
    expect(inboxStatuses("to-reply", ["failed"])).toEqual(["unanswered", "draft", "approved"]);
    expect(inboxNarrowing("to-reply", ["escalated", "published"])).toEqual(["escalated"]);
    expect(inboxNarrowing("sent", ["draft"])).toEqual([]);
    expect(inboxNarrowing("failed", ["draft"])).toEqual([]);
  });

  it("treats any status filter as a removable narrowing, since tabs own the status", () => {
    expect(activeStatusTab([])).toBe("all");
    expect(activeStatusTab(["draft"])).toBeNull();
  });

  it("only offers statuses that fit inside To reply in More filters", () => {
    const keys = TO_REPLY_STATUS_OPTIONS.map((option) => option.key);
    expect(keys).toContain("draft");
    expect(keys).not.toContain("published");
    expect(keys).not.toContain("answered");
    expect(keys).not.toContain("failed");
  });

  it("removes failures from the live queue without removing the rest of the batch", () => {
    const batch = [
      { id: "failed-1", status: "failed" },
      { id: "draft-1", status: "draft" },
      { id: "approved-1", status: "approved" },
      { id: "new-1", status: "none" },
      { id: "sent-1", status: "published" },
    ];
    expect(batch.filter((row) => reviewBelongsToTab("to-reply", row.status)).map((row) => row.id))
      .toEqual(["draft-1", "approved-1", "new-1"]);
    expect(batch.filter((row) => reviewBelongsToTab("failed", row.status)).map((row) => row.id))
      .toEqual(["failed-1"]);
    expect(batch.filter((row) => reviewBelongsToTab("sent", row.status)).map((row) => row.id))
      .toEqual(["sent-1"]);
  });
});

describe("row status line", () => {
  it("reads the stored status when nothing is in flight", () => {
    expect(replyStage({ replyStatus: "none", hasReply: false })).toBe("none");
    expect(replyStage({ replyStatus: "draft", hasReply: true })).toBe("draft");
    expect(replyStage({ replyStatus: "approved", hasReply: true })).toBe("draft");
    expect(replyStage({ replyStatus: "published", hasReply: true })).toBe("sent");
    expect(replyStage({ replyStatus: "pending_publish", hasReply: true })).toBe("unconfirmed");
    expect(replyStage({ replyStatus: "failed", hasReply: true })).toBe("failed");
  });

  it("shows work in flight over the stored status, with the Undo window first", () => {
    expect(replyStage({ replyStatus: "none", hasReply: false, writing: true })).toBe("writing");
    expect(replyStage({ replyStatus: "draft", hasReply: true, sending: true })).toBe("sending");
    expect(replyStage({ replyStatus: "draft", hasReply: true, held: true, sending: true })).toBe("held");
  });

  it("does not offer Send on a draft status with no reply text", () => {
    expect(replyStage({ replyStatus: "draft", hasReply: false })).toBe("none");
    expect(isSendable("none")).toBe(false);
    expect(isSendable("draft")).toBe(true);
    expect(isSendable("failed")).toBe(true);
    expect(isSendable("held")).toBe(false);
  });
});

describe("who can send", () => {
  const owner = { canApprove: true, canPublishPositive: true, aiOnly: false };
  const storeManager = { canApprove: false, canPublishPositive: true, aiOnly: false };
  const member = { canApprove: false, canPublishPositive: false, aiOnly: true };

  it("lets an owner send any draft", () => {
    expect(canSendReply({ ...owner, starRating: 1, replyStatus: "draft" })).toBe(true);
  });

  it("lets a store manager send 4–5★ drafts but not 1–3★ ones", () => {
    expect(canSendReply({ ...storeManager, starRating: 5, replyStatus: "draft" })).toBe(true);
    expect(canSendReply({ ...storeManager, starRating: 3, replyStatus: "draft" })).toBe(false);
  });

  it("lets a member send only after a higher role approved the draft", () => {
    expect(canSendReply({ ...member, starRating: 5, replyStatus: "draft" })).toBe(false);
    expect(canSendReply({ ...member, starRating: 1, replyStatus: "approved" })).toBe(true);
  });
});

describe("bulk selection", () => {
  it("ticks everything for drafting", () => {
    expect(defaultPicked(1, false)).toBe(true);
    expect(defaultPicked(5, false)).toBe(true);
  });

  it("starts 1–2★ drafts unticked for sending", () => {
    expect(defaultPicked(1, true)).toBe(false);
    expect(defaultPicked(2, true)).toBe(false);
    expect(defaultPicked(3, true)).toBe(true);
    expect(defaultPicked(5, true)).toBe(true);
  });
});

describe("next review after sending", () => {
  const ids = ["a", "b", "c", "d"];

  it("opens the next open review below", () => {
    expect(nextOpenId(ids, "b")).toBe("c");
  });

  it("wraps to the top at the end of the list", () => {
    expect(nextOpenId(ids, "d")).toBe("a");
  });

  it("skips reviews already being sent", () => {
    expect(nextOpenId(ids, "a", new Set(["b", "c"]))).toBe("d");
  });

  it("returns null when nothing else is open", () => {
    expect(nextOpenId(["a"], "a")).toBeNull();
    expect(nextOpenId(ids, "a", new Set(["b", "c", "d"]))).toBeNull();
  });
});

describe("ages", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  it("formats short and long ages", () => {
    expect(shortAge("2026-11-03T08:00:00Z", now)).toBe("4h");
    expect(shortAge("2026-11-01T12:00:00Z", now)).toBe("2d");
    expect(longAge("2026-11-03T08:00:00Z", now)).toBe("4 hours");
    expect(longAge("2026-11-02T12:00:00Z", now)).toBe("1 day");
  });
});

describe("old /escalations links", () => {
  it("land on the Follow-ups tab with scope, period and search kept", () => {
    const href = followUpsHref({ client: "c1", group: "g1", location: "l1", range: "30d", q: "refund", page: "3" });
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/reviews");
    expect(url.searchParams.get("tab")).toBe("follow-ups");
    expect(url.searchParams.get("client")).toBe("c1");
    expect(url.searchParams.get("group")).toBe("g1");
    expect(url.searchParams.get("location")).toBe("l1");
    expect(url.searchParams.get("range")).toBe("30d");
    expect(url.searchParams.get("q")).toBe("refund");
    expect(url.searchParams.get("page")).toBeNull();
  });

  it("selects the case for a case page", () => {
    const id = "6f1c2c1e-1111-4a5b-9c0d-1234567890ab";
    const url = new URL(followUpsHref({ location: "l1" }, id), "http://localhost");
    expect(url.searchParams.get("id")).toBe(id);
    expect(url.searchParams.get("location")).toBe("l1");
  });

  it("maps old queues onto Open, Overdue and Done", () => {
    expect(parseFollowUpQueue("needs_human")).toBe("open");
    expect(parseFollowUpQueue("in_progress")).toBe("open");
    expect(parseFollowUpQueue("past_sla")).toBe("past_sla");
    expect(parseFollowUpQueue("resolved")).toBe("resolved");
    expect(new URL(followUpsHref({ queue: "past_sla" }), "http://x").searchParams.get("queue")).toBe("past_sla");
    expect(new URL(followUpsHref({ queue: "in_progress" }), "http://x").searchParams.get("queue")).toBeNull();
  });
});

describe("Add apology rewrite", () => {
  it("asks for an apology without compensation and keeps the draft's facts", () => {
    const text = adjustmentInstruction({ kind: "apology" }, "Thanks for telling us.");
    expect(text).toContain("apology");
    expect(text).toContain("do not add compensation");
    expect(text).toContain("CURRENT DRAFT");
  });
});
