/**
 * Status vocabulary and inbox rules for the Reviews screen. Plain module (no
 * "use client") so the server page, the client inbox and the filter bar share
 * it, and the rules can be unit tested. Status keys are the existing `filter`
 * URL values from lib/review-filter-params.
 */

export interface ReviewStatusOption {
  key: string;
  label: string;
  /** Short line under the option in the More filters drawer. */
  hint?: string;
}

/** Every status the inbox query understands, for combining several at once. */
export const REVIEW_STATUS_OPTIONS: readonly ReviewStatusOption[] = [
  { key: "unanswered", label: "Needs reply", hint: "No reply drafted or published yet" },
  { key: "attention", label: "Needs attention", hint: "No reply or a draft waiting for review" },
  { key: "escalated", label: "Escalated", hint: "1–3★ without a published reply" },
  { key: "draft", label: "Drafts", hint: "Waiting for review or approval" },
  { key: "approved", label: "Ready to publish", hint: "Approved, or publishing now" },
  { key: "failed", label: "Failed", hint: "Google did not accept the reply" },
  { key: "published", label: "Published", hint: "Reply is live on Google" },
  { key: "reopened", label: "Reopened", hint: "Customer edited after a published reply" },
  { key: "answered", label: "Any reply", hint: "Any reply status except none" },
];

export function statusLabel(key: string): string {
  return REVIEW_STATUS_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

/**
 * The tabs own the reply status now, so any `filter` value narrows the tab.
 * Returns "all" for no status filter, otherwise null (a custom narrowing the
 * filter bar shows as a removable chip).
 */
export function activeStatusTab(statuses: readonly string[]): string | null {
  return statuses.length === 0 ? "all" : null;
}

// ---------------------------------------------------------------------------
// Inbox tabs
// ---------------------------------------------------------------------------

export type InboxTab = "to-reply" | "failed" | "follow-ups" | "sent";
export type ReviewInboxTab = Exclude<InboxTab, "follow-ups">;

export const INBOX_TABS: ReadonlyArray<{ key: InboxTab; label: string }> = [
  { key: "to-reply", label: "To reply" },
  { key: "failed", label: "Failed replies" },
  { key: "follow-ups", label: "Follow-ups" },
  { key: "sent", label: "Sent" },
];

/** Work in the normal reply queue; publishing failures have their own tab. */
export const TO_REPLY_STATUSES = ["unanswered", "draft", "approved"] as const;
export const FAILED_REPLY_STATUSES = ["failed"] as const;
export const SENT_STATUSES = ["published"] as const;

/** Statuses that narrow To reply further (More filters, and old `filter=` links). */
const TO_REPLY_NARROWING = new Set(["unanswered", "attention", "escalated", "draft", "approved"]);

/**
 * The tab for a request. `tab` wins; otherwise an old `filter=published` link
 * opens Sent, and an old `filter=failed` link opens Failed replies.
 */
export function parseInboxTab(tab: string | string[] | undefined, statuses: readonly string[] = []): InboxTab {
  const value = Array.isArray(tab) ? tab[0] : tab;
  if (value === "follow-ups" || value === "followups") return "follow-ups";
  if (value === "sent") return "sent";
  if (value === "failed" || value === "failed-replies") return "failed";
  if (value === "to-reply" || value === "reply") return "to-reply";
  if (statuses.length > 0 && statuses.every((status) => status === "failed")) return "failed";
  if (statuses.length > 0 && statuses.every((status) => status === "published" || status === "answered")) {
    return "sent";
  }
  return "to-reply";
}

/**
 * Status keys to query for a tab. A narrowing that fits inside To reply is
 * kept; anything else falls back to the whole tab.
 */
export function inboxStatuses(tab: InboxTab, statuses: readonly string[]): string[] {
  if (tab === "sent") return [...SENT_STATUSES];
  if (tab === "failed") return [...FAILED_REPLY_STATUSES];
  const narrowing = statuses.filter((status) => TO_REPLY_NARROWING.has(status));
  return narrowing.length > 0 ? narrowing : [...TO_REPLY_STATUSES];
}

/** The `filter` values the page shows as a narrowing chip (none for the tab default). */
export function inboxNarrowing(tab: InboxTab, statuses: readonly string[]): string[] {
  if (tab !== "to-reply") return [];
  return statuses.filter((status) => TO_REPLY_NARROWING.has(status));
}

/** Status options offered in More filters on To reply. Other tabs offer none. */
export const TO_REPLY_STATUS_OPTIONS: readonly ReviewStatusOption[] = REVIEW_STATUS_OPTIONS.filter((option) =>
  TO_REPLY_NARROWING.has(option.key) && option.key !== "attention"
);

/** Keep local row updates in the same queue as the server query. */
export function reviewBelongsToTab(tab: ReviewInboxTab, status: string): boolean {
  if (tab === "failed") return status === "failed";
  if (tab === "sent") return status === "published";
  return status === "none" || status === "draft" || status === "approved" || status === "pending_publish";
}

// ---------------------------------------------------------------------------
// Row rules
// ---------------------------------------------------------------------------

/** What a row's status line says. */
export type ReplyStage =
  | "none" // No reply yet
  | "writing" // AI is drafting
  | "draft" // Draft ready to read and send
  | "sending" // Posting to Google
  | "held" // Sent, inside the Undo window (not posted yet)
  | "sent" // Live on Google
  | "unconfirmed" // Google did not confirm the publish
  | "failed"; // Google refused the reply

export function replyStage(input: {
  replyStatus: string;
  hasReply: boolean;
  writing?: boolean;
  sending?: boolean;
  held?: boolean;
}): ReplyStage {
  if (input.held) return "held";
  if (input.sending) return "sending";
  if (input.writing) return "writing";
  switch (input.replyStatus) {
    case "published":
      return "sent";
    case "pending_publish":
      return "unconfirmed";
    case "failed":
      return "failed";
    case "draft":
    case "approved":
      return input.hasReply ? "draft" : "none";
    default:
      return "none";
  }
}

/** Stages a send can start from. */
export function isSendable(stage: ReplyStage): boolean {
  return stage === "draft" || stage === "failed";
}

/**
 * Whether this person may post the reply. Mirrors assertPublishAccess:
 * 4–5★ need publish rights, 1–3★ need approval rights, and a member may post
 * only a reply a higher role already approved.
 */
export function canSendReply(input: {
  starRating: number;
  replyStatus: string;
  canApprove: boolean;
  canPublishPositive: boolean;
  aiOnly: boolean;
}): boolean {
  if (input.replyStatus === "approved") {
    return input.canApprove || input.canPublishPositive || input.aiOnly;
  }
  if (input.aiOnly) return false;
  return input.starRating >= 4 ? input.canPublishPositive || input.canApprove : input.canApprove;
}

/** Low ratings are read before they go out. */
export function isLowRating(starRating: number): boolean {
  return starRating <= 2;
}

/**
 * Whether a row starts ticked. Everything is ticked for drafting; once a
 * draft exists, 1–2★ start unticked so someone reads them before sending.
 */
export function defaultPicked(starRating: number, hasDraft: boolean): boolean {
  return hasDraft ? !isLowRating(starRating) : true;
}

/**
 * The review to open after `currentId` is sent or moved: the next open one
 * below it, wrapping to the top. Returns null when nothing else is open.
 */
export function nextOpenId(openIds: readonly string[], currentId: string, skip: ReadonlySet<string> = new Set()): string | null {
  const index = openIds.indexOf(currentId);
  const ordered = index < 0 ? [...openIds] : [...openIds.slice(index + 1), ...openIds.slice(0, index)];
  return ordered.find((id) => id !== currentId && !skip.has(id)) ?? null;
}

/** "3 reviews need" / "1 review needs". */
export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** "4h", "2d", "3w" for list rows. */
export function shortAge(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

/** "4 hours", "2 days" for the detail header ("… ago on Google"). */
export function longAge(iso: string, now = Date.now()): string {
  const short = shortAge(iso, now);
  const value = Number.parseInt(short, 10);
  const unit = short.replace(/^\d+/, "");
  const word = { m: "minute", h: "hour", d: "day", w: "week", mo: "month" }[unit] ?? unit;
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export type FollowUpQueue = "open" | "past_sla" | "resolved";

export const FOLLOW_UP_QUEUES: ReadonlyArray<{ key: FollowUpQueue; label: string }> = [
  { key: "open", label: "Open" },
  { key: "past_sla", label: "Overdue" },
  { key: "resolved", label: "Done" },
];

/** Old /escalations queues (To do, In progress) land on Open. */
export function parseFollowUpQueue(value: string | string[] | undefined): FollowUpQueue {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "past_sla" || raw === "resolved" ? raw : "open";
}

/** Params an old /escalations link carries over: scope, period, search, queue. */
const CARRIED_PARAMS = ["client", "group", "location", "range", "from", "to", "q", "queue", "sort"] as const;

/**
 * Where an old /escalations URL now lives: the Follow-ups tab of Reviews,
 * with scope kept and, for a case page, the case selected.
 */
export function followUpsHref(
  params: Record<string, string | string[] | undefined>,
  escalationId?: string | null
): string {
  const query = new URLSearchParams();
  query.set("tab", "follow-ups");
  for (const key of CARRIED_PARAMS) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) continue;
    if (key === "queue") {
      const queue = parseFollowUpQueue(value);
      if (queue !== "open") query.set("queue", queue);
      continue;
    }
    query.set(key, value);
  }
  if (escalationId) query.set("id", escalationId);
  return `/reviews?${query.toString()}`;
}
