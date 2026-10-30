/**
 * Status vocabulary for the Reviews screen. Plain module (no "use client") so
 * the server page (tabs) and the client filter bar (More filters) share it.
 * Keys are the existing `filter` URL values from lib/review-filter-params.
 */

export interface ReviewStatusOption {
  key: string;
  label: string;
  /** Short line under the option in the More filters drawer. */
  hint?: string;
}

/** Built-in views shown as tabs, in working order. `all` clears the status filter. */
export const REVIEW_STATUS_TABS: readonly ReviewStatusOption[] = [
  { key: "unanswered", label: "Needs reply" },
  { key: "escalated", label: "Escalated" },
  { key: "draft", label: "Drafts" },
  { key: "approved", label: "Ready to publish" },
  { key: "failed", label: "Failed" },
  { key: "published", label: "Published" },
  { key: "all", label: "All" },
];

/** Every status the inbox query understands, for combining several at once. */
export const REVIEW_STATUS_OPTIONS: readonly ReviewStatusOption[] = [
  { key: "unanswered", label: "Needs reply", hint: "No reply drafted or published yet" },
  { key: "attention", label: "Needs attention", hint: "No reply, a draft, or a failed publish" },
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

/** The tab a status selection maps to, or null when it is a custom combination. */
export function activeStatusTab(statuses: readonly string[]): string | null {
  if (statuses.length === 0) return "all";
  if (statuses.length === 1 && REVIEW_STATUS_TABS.some((tab) => tab.key === statuses[0])) {
    return statuses[0]!;
  }
  return null;
}
