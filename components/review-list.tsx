"use client";

import { useEffect, useMemo, useState } from "react";
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
            "h-3.5 w-3.5",
            i < rating
              ? rating >= 4
                ? "fill-green-500 text-green-500"
                : rating === 3
                  ? "fill-yellow-400 text-yellow-500"
                  : "fill-red-500 text-red-500"
              : "fill-[#eceae6] text-[#eceae6]"
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}

const STATUS_CONFIG: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  published:       { label: "Published", className: "bg-[#ede9ff] text-[#4823ff]",  Icon: CheckCircle2 },
  approved:        { label: "Ready",  className: "bg-[#4823ff] text-white",   Icon: CheckCircle2 },
  draft:           { label: "Draft",     className: "bg-[#fafaf8] text-[#898b91] border border-[#d9d2ff]",   Icon: Pencil },
  failed:          { label: "Failed",    className: "bg-[#1e1b22] text-[#e7ff6e]",    Icon: AlertCircle },
  pending_publish: { label: "Publishing", className: "bg-[#ede9ff] text-[#4823ff]", Icon: Clock },
};

function ReplyStatusPill({ status, source }: { status: string; source?: string }) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  const { Icon, className, label } = cfg;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
      {source === "ai" && status !== "published" && (
        <Sparkles className="ml-0.5 h-2.5 w-2.5" aria-hidden />
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

  useEffect(() => {
    if (!selectedId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

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
      <div className="flex flex-wrap items-center gap-2 rounded-[20px] border border-[#d9d2ff] bg-white px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-[#18161a]">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(e) => toggleAll(e.target.checked)}
            className="rounded border-gray-300"
          />
          Select all on page
        </label>
        <span className="text-sm text-[#898b91]">
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

      <div
        className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
        role="list"
        aria-label="Reviews"
      >
        {reviews.map((review) => {
          const isActive = review.id === selectedId;
          const reply = replies[review.id];
          const hasGoogleReply = !!review.google_reply_comment;
          const name = review.reviewer_is_anonymous
            ? "Anonymous"
            : review.reviewer_display_name || "Unknown reviewer";
          const initials = name
            .split(" ")
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("");

          return (
            <article
              key={review.id}
              role="listitem"
              className={cn(
                "flex flex-col rounded-[20px] border bg-white p-5 text-left transition-colors",
                isActive
                  ? "border-[#4823ff] bg-[#ede9ff]/40"
                  : "border-[#d9d2ff] hover:border-[#4823ff]"
              )}
            >
              <div className="flex items-start gap-3">
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
                  className="mt-1 rounded border-[#d9d2ff]"
                  aria-label={`Select review by ${name}`}
                />
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    review.star_rating >= 4
                      ? "bg-green-50 text-green-700"
                      : review.star_rating === 3
                        ? "bg-yellow-50 text-yellow-700"
                        : "bg-red-50 text-red-700"
                  )}
                >
                  {initials || review.star_rating}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-[#18161a]">
                      {name}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                        review.star_rating >= 4
                          ? "bg-green-50 text-green-700"
                          : review.star_rating === 3
                            ? "bg-yellow-50 text-yellow-700"
                            : "bg-red-50 text-red-700"
                      )}
                    >
                      {review.star_rating}/5
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs font-light text-[#898b91]">
                    {formatRelativeDate(review.review_create_time)}
                    {" · "}
                    {review.location_title}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedId(review.id)}
                className="mt-4 flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4823ff]"
                aria-label={`Open review by ${name}`}
              >
                <StarRating rating={review.star_rating} />
                <p className="mt-3 line-clamp-5 min-h-[7.5rem] text-sm font-light leading-relaxed text-[#18161a]">
                  {review.comment || "Rating only — no written comment."}
                </p>
              </button>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {hasGoogleReply && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#e7ff6e] px-2.5 py-1 text-[11px] font-semibold text-[#18161a]">
                    <MessageSquare className="h-3 w-3" aria-hidden />
                    On Google
                  </span>
                )}
                {review.reply_status !== "none" && (
                  <ReplyStatusPill
                    status={review.reply_status}
                    source={reply?.source}
                  />
                )}
                {review.reply_status === "none" && !hasGoogleReply && (
                  <span className="text-xs font-light text-[#898b91]">
                    Needs a reply
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {selectedReview && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#18161a]/45 p-3 sm:items-center sm:p-6"
          role="presentation"
          onClick={() => setSelectedId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Review by ${selectedReview.reviewer_display_name || "reviewer"}`}
            className="flex h-[min(92vh,860px)] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] border border-[#d9d2ff] bg-white shadow-none"
            onClick={(event) => event.stopPropagation()}
          >
            <ReviewDetailPanel
              review={selectedReview}
              reply={selectedReply}
              canApprove={canApprove}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
