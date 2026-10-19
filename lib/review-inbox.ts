import { readableReviewText, splitGoogleTranslation } from "@/lib/review-text";

export const REVIEW_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ml", label: "Malayalam" },
  { id: "hi", label: "Hindi" },
  { id: "ta", label: "Tamil" },
  { id: "ar", label: "Arabic" },
  { id: "other", label: "Other" },
  { id: "none", label: "No text" },
] as const;

export const COMPLAINT_THEMES = [
  { id: "wait", label: "Wait time", words: ["wait", "waiting", "slow", "delay", "queue", "late"] },
  { id: "staff", label: "Staff", words: ["rude", "staff", "manager", "service", "attitude", "unprofessional"] },
  { id: "price", label: "Price", words: ["price", "expensive", "cost", "overcharg", "bill", "refund"] },
  { id: "cleanliness", label: "Cleanliness", words: ["dirty", "clean", "hygiene", "smell", "stain"] },
  { id: "quality", label: "Quality", words: ["quality", "broken", "defect", "wrong", "stale", "damaged"] },
  { id: "unspecified", label: "Unspecified complaint", words: [] },
] as const;

export type InboxSort = "newest" | "oldest" | "highest" | "lowest";

export interface WorkflowInput {
  replyStatus: string;
  starRating: number;
  reopenedAt: string | null;
  hasGoogleReply: boolean;
}

/** Derived from the stored reply status. Scheduled publishing is not a state in this app. */
export function workflowState(input: WorkflowInput): { id: string; label: string } {
  const replied = input.replyStatus === "published" || (input.hasGoogleReply && input.replyStatus === "none");
  if (input.reopenedAt && (input.replyStatus === "published" || input.hasGoogleReply)) {
    return { id: "reopened", label: "Reopened" };
  }
  if (replied) return { id: "replied", label: "Replied" };
  if (input.replyStatus === "draft") return { id: "draft", label: "Draft ready" };
  if (input.replyStatus === "approved" || input.replyStatus === "pending_publish") {
    return { id: "ready", label: "Ready to publish" };
  }
  if (input.replyStatus === "failed") return { id: "failed", label: "Publish failed" };
  if (input.starRating <= 3) return { id: "escalated", label: "Escalated" };
  return { id: "unreplied", label: "Unreplied" };
}

export function detectReviewLanguage(comment: string | null | undefined): string {
  if (!comment?.trim()) return "none";
  const { original } = splitGoogleTranslation(comment);
  if (/[\u0D00-\u0D7F]/.test(original)) return "ml";
  if (/[\u0900-\u097F]/.test(original)) return "hi";
  if (/[\u0B80-\u0BFF]/.test(original)) return "ta";
  if (/[\u0600-\u06FF]/.test(original)) return "ar";
  if (/[A-Za-z]/.test(original)) return "en";
  return "other";
}

export function detectComplaintTheme(
  comment: string | null | undefined,
  starRating: number
): string | null {
  if (starRating > 3) return null;
  const text = readableReviewText(comment ?? null)?.toLowerCase() ?? "";
  if (!text) return "unspecified";
  for (const theme of COMPLAINT_THEMES) {
    if (theme.id === "unspecified") continue;
    if (theme.words.some((word) => text.includes(word))) return theme.id;
  }
  return "unspecified";
}

export function languageLabel(id: string | null | undefined): string | null {
  return REVIEW_LANGUAGES.find((item) => item.id === id)?.label ?? null;
}

export function themeLabel(id: string | null | undefined): string | null {
  return COMPLAINT_THEMES.find((item) => item.id === id)?.label ?? null;
}

/** A published review reopens only when the stars or the written text change. */
export function shouldReopenReview(input: {
  replyStatus: string;
  previousComment: string | null;
  previousStars: number;
  nextComment: string | null;
  nextStars: number;
}): boolean {
  const published = input.replyStatus === "published" || input.replyStatus === "pending_publish";
  if (!published) return false;
  return input.previousComment !== input.nextComment || input.previousStars !== input.nextStars;
}
