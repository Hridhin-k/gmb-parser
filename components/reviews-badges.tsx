import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { workflowState } from "@/lib/review-inbox";

type BadgeVariant = "default" | "brand" | "ok" | "warn" | "bad" | "ai" | "info";

export interface ReviewStateBadge {
  key: string;
  label: string;
  variant: BadgeVariant;
  ai?: boolean;
}

/**
 * Status tags for a review, from the stored reply status. Meanings are fixed:
 * Needs reply = default, AI draft = ai, Approved = brand, Publishing = info,
 * Published = ok, Unconfirmed/Reopened = warn, Failed/Escalated = bad.
 */
export function reviewStateBadges(input: {
  replyStatus: string;
  starRating: number;
  reopenedAt: string | null;
  hasGoogleReply: boolean;
  source?: string | null;
  publishing?: boolean;
}): ReviewStateBadge[] {
  if (input.publishing) return [{ key: "publishing", label: "Publishing…", variant: "info" }];
  const state = workflowState(input);
  switch (state.id) {
    case "reopened":
      return [{ key: "reopened", label: "Reopened", variant: "warn" }];
    case "replied":
      return [
        {
          key: "replied",
          label: input.replyStatus === "published" ? "Published" : "Replied on Google",
          variant: "ok",
        },
      ];
    case "draft":
      return input.source === "ai"
        ? [{ key: "draft", label: "AI draft", variant: "ai", ai: true }]
        : [{ key: "draft", label: "Draft", variant: "default" }];
    case "ready":
      return input.replyStatus === "pending_publish"
        ? [{ key: "pending", label: "Awaiting confirmation", variant: "warn" }]
        : [{ key: "approved", label: "Approved", variant: "brand" }];
    case "failed":
      return [{ key: "failed", label: "Publish failed", variant: "bad" }];
    case "escalated":
      return [
        { key: "needs", label: "Needs reply", variant: "default" },
        { key: "escalated", label: "Escalated", variant: "bad" },
      ];
    default:
      return [{ key: "needs", label: "Needs reply", variant: "default" }];
  }
}

export function ReviewStateBadges({ badges }: { badges: ReviewStateBadge[] }) {
  return (
    <>
      {badges.map((badge) => (
        <Badge key={badge.key} variant={badge.variant}>
          {badge.ai ? <Sparkles aria-hidden /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}
          {badge.label}
        </Badge>
      ))}
    </>
  );
}

/** Amber text stars, compact for rows and drawer headers. */
export function InlineStars({ rating }: { rating: number }) {
  return (
    <span role="img" className="whitespace-nowrap text-xs tracking-[1px] text-star" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(Math.max(0, Math.min(5, rating)))}
      <span className="text-[#d6dae1]">{"★".repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}
