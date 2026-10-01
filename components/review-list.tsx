"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Star,
  CheckCircle2,
  Pencil,
  AlertCircle,
  Clock,
  MessageSquare,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReviewDetailPanel } from "@/components/review-detail-panel";

interface ReviewItem {
  id: string;
  reviewer_display_name: string;
  reviewer_is_anonymous: boolean;
  star_rating: number;
  comment: string | null;
  review_create_time: string;
  review_update_time: string | null;
  google_reply_comment: string | null;
  google_reply_update_time: string | null;
  reply_status: string;
  location_title: string;
  client_name: string | null;
}

interface ReplyItem {
  id: string;
  content: string;
  source: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  published_at: string | null;
  last_error: string | null;
  failure_count: number;
}

interface ReviewListProps {
  reviews: ReviewItem[];
  replies: Record<string, ReplyItem>;
  canApprove: boolean;
}

type BulkAction = "generate" | "approve" | "publish" | "discard";

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-px" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3 w-3",
            i < rating
              ? "fill-amber-400 text-amber-400"
              : "fill-gray-200 text-gray-200"
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}

const STATUS_CONFIG: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  published:       { label: "Published", className: "text-green-600",  Icon: CheckCircle2 },
  approved:        { label: "Approved",  className: "text-blue-600",   Icon: CheckCircle2 },
  draft:           { label: "Draft",     className: "text-gray-400",   Icon: Pencil },
  failed:          { label: "Failed",    className: "text-red-500",    Icon: AlertCircle },
  pending_publish: { label: "Publishing", className: "text-amber-500", Icon: Clock },
};

function ReplyStatusPill({ status, source }: { status: string; source?: string }) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  const { Icon, className, label } = cfg;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
      {source === "ai" && status !== "published" && (
        <Sparkles className="ml-0.5 h-2.5 w-2.5 text-purple-400" aria-hidden />
      )}
    </span>
  );
}

export function ReviewList({ reviews, replies, canApprove }: ReviewListProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState<BulkAction | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const selectedReview = reviews.find((r) => r.id === selectedId) ?? null;
  const selectedReply = selectedId ? (replies[selectedId] ?? null) : null;

  const selectedIds = useMemo(
    () => Object.entries(checked).filter(([, v]) => v).map(([id]) => id),
    [checked]
  );

  const allChecked =
    reviews.length > 0 && reviews.every((r) => checked[r.id]);

  function toggleAll(next: boolean) {
    const nextMap: Record<string, boolean> = {};
    for (const r of reviews) nextMap[r.id] = next;
    setChecked(nextMap);
  }

  async function runBulk(action: BulkAction) {
    if (selectedIds.length === 0) return;
    setBulkError(null);
    setBulkMessage(null);
    setBulkLoading(action);
    try {
      const response = await fetch("/api/reviews/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewIds: selectedIds }),
      });
      const data = (await response.json()) as {
        error?: string;
        succeeded?: number;
        failed?: number;
      };
      if (!response.ok) {
        setBulkError(data.error ?? "Bulk action failed");
        return;
      }
      setBulkMessage(
        `${action}: ${data.succeeded ?? 0} succeeded` +
          ((data.failed ?? 0) > 0 ? `, ${data.failed} failed` : "")
      );
      setChecked({});
      router.refresh();
    } catch {
      setBulkError("Unable to run bulk action");
    } finally {
      setBulkLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <label className="flex items-center gap-2 text-[12px] text-gray-600">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(e) => toggleAll(e.target.checked)}
            className="rounded border-gray-300"
          />
          Select all on page
        </label>
        <span className="text-[12px] text-gray-400">
          {selectedIds.length} selected
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={selectedIds.length === 0 || bulkLoading !== null}
            onClick={() => runBulk("generate")}
            className="gap-1"
          >
            {bulkLoading === "generate" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            AI draft
          </Button>
          {canApprove ? (
            <Button
              size="xs"
              variant="outline"
              disabled={selectedIds.length === 0 || bulkLoading !== null}
              onClick={() => runBulk("approve")}
            >
              Approve
            </Button>
          ) : null}
          <Button
            size="xs"
            disabled={selectedIds.length === 0 || bulkLoading !== null}
            onClick={() => runBulk("publish")}
          >
            {bulkLoading === "publish"
              ? "Publishing…"
              : canApprove
                ? "Approve & publish"
                : "Publish"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={selectedIds.length === 0 || bulkLoading !== null}
            onClick={() => runBulk("discard")}
            className="text-red-600 hover:text-red-700"
          >
            Reject drafts
          </Button>
        </div>
      </div>

      {(bulkError || bulkMessage) && (
        <p
          className={cn(
            "text-xs",
            bulkError ? "text-red-600" : "text-emerald-700"
          )}
          role={bulkError ? "alert" : "status"}
        >
          {bulkError ?? bulkMessage}
        </p>
      )}

      <div className="flex min-h-[min(70vh,640px)] overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div
          className={cn(
            "divide-y divide-gray-100 overflow-y-auto",
            selectedReview ? "hidden lg:block lg:w-[55%]" : "w-full"
          )}
          role="listbox"
          aria-label="Reviews"
        >
          {reviews.map((review) => {
            const isActive = review.id === selectedId;
            const reply = replies[review.id];
            const hasGoogleReply = !!review.google_reply_comment;

            return (
              <div
                key={review.id}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-3 transition-colors",
                  isActive
                    ? "bg-blue-50/70 border-l-2 border-l-primary"
                    : "border-l-2 border-l-transparent hover:bg-gray-50/80"
                )}
              >
                <input
                  type="checkbox"
                  checked={!!checked[review.id]}
                  onChange={(e) =>
                    setChecked((prev) => ({
                      ...prev,
                      [review.id]: e.target.checked,
                    }))
                  }
                  onClick={(e) => e.stopPropagation()}
                  className="mt-2 rounded border-gray-300"
                  aria-label={`Select review by ${review.reviewer_display_name}`}
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(review.id)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none"
                  role="option"
                  aria-selected={isActive}
                >
                  <div className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
                    <div
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                        review.star_rating >= 4
                          ? "bg-green-50 text-green-700"
                          : review.star_rating === 3
                            ? "bg-amber-50 text-amber-700"
                            : "bg-red-50 text-red-700"
                      )}
                    >
                      {review.star_rating}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-medium text-gray-900">
                        {review.reviewer_is_anonymous
                          ? "Anonymous"
                          : review.reviewer_display_name || "Unknown reviewer"}
                      </p>
                      <span className="shrink-0 text-[11px] text-gray-400">
                        {formatRelativeDate(review.review_create_time)}
                      </span>
                    </div>

                    <div className="mt-0.5 flex items-center gap-1.5">
                      <StarRating rating={review.star_rating} />
                      <span className="text-[11px] text-gray-300">·</span>
                      <span className="truncate text-[11px] text-gray-400">
                        {review.location_title}
                      </span>
                    </div>

                    {review.comment && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">
                        {review.comment}
                      </p>
                    )}

                    <div className="mt-1.5 flex items-center gap-2">
                      {hasGoogleReply && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-green-600">
                          <MessageSquare className="h-2.5 w-2.5" aria-hidden />
                          Replied on Google
                        </span>
                      )}
                      {review.reply_status !== "none" && (
                        <ReplyStatusPill
                          status={review.reply_status}
                          source={reply?.source}
                        />
                      )}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {selectedReview && (
          <div className="flex w-full min-h-0 flex-col border-l border-gray-200 lg:w-[45%] lg:min-w-[380px]">
            <ReviewDetailPanel
              review={selectedReview}
              reply={selectedReply}
              canApprove={canApprove}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
