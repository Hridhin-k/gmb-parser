/**
 * Canonical user-facing copy for loading, refresh, AI, and failure states.
 * Messages describe only what the app can honestly know.
 */

export type StatusTone = "work" | "google" | "gemini";

export interface StatusCopy {
  title: string;
  detail: string;
  tone?: StatusTone;
  /** Short label for buttons / floating pills. */
  short: string;
}

/** Page initial-load skeletons (`loading.tsx`). */
export const PAGE_LOADING = {
  default: {
    title: "Loading this page",
    detail: "Fetching the latest workspace data. The sidebar stays available while this finishes.",
    short: "Loading…",
    tone: "work" as const,
  },
  overview: {
    title: "Loading your organisation's overview…",
    detail: "Counting ratings, replies, and the locations that need attention for the selected scope.",
    short: "Loading overview…",
    tone: "work" as const,
  },
  reviews: {
    title: "Fetching reviews for the selected locations…",
    detail: "Opening the inbox. Drafts and published replies appear with each review.",
    short: "Loading reviews…",
    tone: "work" as const,
  },
  analytics: {
    title: "Calculating review trends…",
    detail: "Counting reviews, ratings, and reply times for the selected locations and period.",
    short: "Calculating…",
    tone: "work" as const,
  },
  insights: {
    title: "Opening insights…",
    detail: "Counting this scope’s reviews for the selected period before any model text is shown.",
    short: "Loading insights…",
    tone: "work" as const,
  },
  escalations: {
    title: "Loading escalations…",
    detail: "Opening complaints that need a person, with their due times and owners.",
    short: "Loading escalations…",
    tone: "work" as const,
  },
  settings: {
    title: "Loading settings…",
    detail: "Checking AI configuration, Google connections, and workspace preferences.",
    short: "Loading settings…",
    tone: "work" as const,
  },
  reports: {
    title: "Loading reports…",
    detail: "Opening scheduled reports and alert rules for this workspace.",
    short: "Loading reports…",
    tone: "work" as const,
  },
  requests: {
    title: "Loading review requests…",
    detail: "Opening request links and delivery settings.",
    short: "Loading requests…",
    tone: "work" as const,
  },
  clients: {
    title: "Loading clients…",
    detail: "Adding up locations, unreplied reviews, and connection status for this workspace.",
    short: "Loading clients…",
    tone: "work" as const,
  },
  team: {
    title: "Loading team…",
    detail: "Opening members, invites, and notification preferences.",
    short: "Loading team…",
    tone: "work" as const,
  },
  audit: {
    title: "Loading activity…",
    detail: "Opening the audit log for this workspace.",
    short: "Loading activity…",
    tone: "work" as const,
  },
  onboarding: {
    title: "Opening setup…",
    detail: "Checking which setup steps are still open.",
    short: "Loading setup…",
    tone: "work" as const,
  },
} satisfies Record<string, StatusCopy>;

/** Soft refresh while previous numbers stay hidden until the new scope matches. */
export const SCOPE_REFRESH = {
  overview: {
    title: "Updating overview…",
    detail: "Refreshing counts for the selected organisation, group, or location. Previous figures stay hidden until they match.",
    short: "Updating overview…",
    tone: "work" as const,
  },
  reviews: {
    title: "Updating reviews…",
    detail: "Fetching reviews for the selected locations and filters.",
    short: "Updating reviews…",
    tone: "work" as const,
  },
  analytics: {
    title: "Recalculating analytics…",
    detail: "Calculating review trends for the selected locations and period.",
    short: "Recalculating analytics…",
    tone: "work" as const,
  },
  insights: {
    title: "Updating insights…",
    detail: "Refreshing counted insights for the selected scope and period.",
    short: "Updating insights…",
    tone: "work" as const,
  },
  escalations: {
    title: "Updating escalations…",
    detail: "Refreshing open cases for the selected scope.",
    short: "Updating escalations…",
    tone: "work" as const,
  },
  reports: {
    title: "Updating reports…",
    detail: "Refreshing report settings for the selected scope.",
    short: "Updating reports…",
    tone: "work" as const,
  },
  requests: {
    title: "Updating requests…",
    detail: "Refreshing review-request settings for the selected scope.",
    short: "Updating requests…",
    tone: "work" as const,
  },
  audit: {
    title: "Filtering activity…",
    detail: "Applying the selected filters to the audit log.",
    short: "Filtering activity…",
    tone: "work" as const,
  },
  generic: {
    title: "Updating this scope…",
    detail: "Loading data that matches the organisation, group, or location you selected.",
    short: "Updating…",
    tone: "work" as const,
  },
} satisfies Record<string, StatusCopy>;

/** Async action status while a button is busy. */
export const ACTION_STATUS = {
  aiDraft: {
    title: "Generating your AI reply…",
    detail: "AI is drafting a reply using your organisation's saved guidelines. Nothing is posted to Google until you approve it.",
    short: "Generating reply…",
    tone: "gemini" as const,
  },
  aiInsight: {
    title: "Analysing customer feedback…",
    detail: "The model is preparing an interpretation for the selected scope. Counted totals above stay available.",
    short: "Generating summary…",
    tone: "gemini" as const,
  },
  applying: {
    title: "Updating this page…",
    detail: "The new text is already on screen. The rest of the page is catching up.",
    short: "Updating…",
    tone: "work" as const,
  },
  aiPreview: {
    title: "Running draft preview…",
    detail: "Building a sample reply with your saved instructions. Nothing is published or stored.",
    short: "Previewing…",
    tone: "gemini" as const,
  },
  saveAi: {
    title: "Saving your organisation's AI rules…",
    detail: "Persisting organisation context and brand voice for this workspace.",
    short: "Saving…",
    tone: "work" as const,
  },
  save: {
    title: "Saving your changes…",
    detail: "Writing the update for this workspace.",
    short: "Saving…",
    tone: "work" as const,
  },
  publish: {
    title: "Submitting your reply…",
    detail: "Sending the approved reply to Google Business Profile. Keep this open until it finishes.",
    short: "Submitting…",
    tone: "google" as const,
  },
  sync: {
    title: "Syncing new reviews…",
    detail: "Asking Google for the latest reviews. Replies you already wrote stay in place.",
    short: "Syncing…",
    tone: "google" as const,
  },
  syncAll: {
    title: "Syncing reviews from Google…",
    detail: "Pulling new reviews across connected locations. Replies you already wrote stay in place.",
    short: "Asking Google…",
    tone: "google" as const,
  },
  report: {
    title: "Preparing your report…",
    detail: "Building the export for the selected scope and period.",
    short: "Preparing…",
    tone: "work" as const,
  },
  approve: {
    title: "Approving this reply…",
    detail: "It stays in GRM as ready to publish. It is not on Google yet.",
    short: "Approving…",
    tone: "work" as const,
  },
} satisfies Record<string, StatusCopy>;

/** Map common failure modes to plain-language recovery copy. */
export function explainFailure(
  kind:
    | "generic"
    | "save"
    | "aiDraft"
    | "aiInsight"
    | "publish"
    | "sync"
    | "refresh"
    | "timeout"
    | "forbidden"
    | "unavailable",
  serverMessage?: string | null
): { title: string; detail: string; canRetry: boolean } {
  const trimmed = serverMessage?.trim();
  switch (kind) {
    case "save":
      return {
        title: "Your changes couldn't be saved",
        detail: trimmed || "Please try again. Your form values are still on the page.",
        canRetry: true,
      };
    case "aiDraft":
      return {
        title: "Your AI reply couldn't be generated",
        detail: trimmed || "Your existing draft has been preserved. You can try again or write manually.",
        canRetry: true,
      };
    case "aiInsight":
      return {
        title: "Insights couldn't be updated",
        detail: trimmed || "Counted sections stay available. You can retry the model summary.",
        canRetry: true,
      };
    case "publish":
      return {
        title: "The reply couldn't be submitted",
        detail: trimmed || "The draft is still in GRM. Check the connection and try publishing again.",
        canRetry: true,
      };
    case "sync":
      return {
        title: "We couldn't refresh the reviews",
        detail: trimmed || "Your previously loaded data is still available.",
        canRetry: true,
      };
    case "refresh":
      return {
        title: "This view couldn't be refreshed",
        detail: trimmed || "What you see may be out of date. Try again in a moment.",
        canRetry: true,
      };
    case "timeout":
      return {
        title: "This is taking longer than expected",
        detail: trimmed || "You can keep waiting or try again.",
        canRetry: true,
      };
    case "forbidden":
      return {
        title: "You don't have permission for that",
        detail: trimmed || "Ask an organisation admin if you need access.",
        canRetry: false,
      };
    case "unavailable":
      return {
        title: "A connected service is unavailable",
        detail: trimmed || "Check the connection settings and try again shortly.",
        canRetry: true,
      };
    default:
      return {
        title: "Something went wrong",
        detail: trimmed || "Please try again.",
        canRetry: true,
      };
  }
}

export function failureKindFromStatus(status: number): Parameters<typeof explainFailure>[0] {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 408 || status === 504) return "timeout";
  if (status === 502 || status === 503) return "unavailable";
  return "generic";
}
