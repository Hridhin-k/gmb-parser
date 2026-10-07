"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Star,
  X,
  Send,
  CheckCircle2,
  Pencil,
  Sparkles,
  Trash2,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActivityStatus } from "@/components/activity-status";
import { Spinner } from "@/components/ui/spinner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ReviewForPanel {
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

interface ReplyForPanel {
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

interface ReviewDetailPanelProps {
  review: ReviewForPanel;
  reply: ReplyForPanel | null;
  canApprove: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-4 w-4",
            i < rating
              ? rating >= 4
                ? "fill-green-500 text-green-500"
                : rating === 3
                  ? "fill-yellow-400 text-yellow-500"
                  : "fill-red-500 text-red-500"
              : "fill-silver text-silver"
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const REPLY_STATUS_MAP: Record<
  string,
  { label: string; className: string; dotColor: string }
> = {
  none:            { label: "No reply",       className: "text-slate",  dotColor: "bg-silver" },
  draft:           { label: "Draft",          className: "text-graphite",  dotColor: "bg-slate" },
  approved:        { label: "Approved",       className: "text-ink",  dotColor: "bg-ink" },
  pending_publish: { label: "Publishing...",  className: "text-amber-700",  dotColor: "bg-amber-500" },
  published:       { label: "Published",      className: "text-green-700",  dotColor: "bg-green-500" },
  failed:          { label: "Publish failed", className: "text-red-700",    dotColor: "bg-red-500" },
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ReviewDetailPanel({
  review,
  reply,
  canApprove,
  onClose,
}: ReviewDetailPanelProps) {
  const router = useRouter();
  const [draftContent, setDraftContent] = useState(reply?.content ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviewerName = review.reviewer_is_anonymous
    ? "Anonymous"
    : (review.reviewer_display_name || "Unknown reviewer");

  const statusConfig = REPLY_STATUS_MAP[review.reply_status] ?? REPLY_STATUS_MAP.none;

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function apiCall(url: string, method: string, body?: object) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Request failed");
    }
    return response.json();
  }

  async function handleCreateDraft() {
    if (!draftContent.trim()) return;
    setError(null);
    setLoading("create");
    try {
      await apiCall(`/api/reviews/${review.id}/reply`, "POST", {
        content: draftContent.trim(),
      });
      setIsCreating(false);
      toast.success("Draft saved");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create reply");
    } finally {
      setLoading(null);
    }
  }

  async function handleSaveEdit() {
    if (!reply || !draftContent.trim()) return;
    setError(null);
    setLoading("edit");
    try {
      await apiCall(`/api/reviews/${review.id}/reply`, "PUT", {
        replyId: reply.id,
        content: draftContent.trim(),
      });
      setIsEditing(false);
      toast.success("Changes saved");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save edit");
    } finally {
      setLoading(null);
    }
  }

  async function handleApprove() {
    if (!reply) return;
    setError(null);
    setLoading("approve");
    try {
      await apiCall(`/api/reviews/${review.id}/reply/approve`, "POST", {
        replyId: reply.id,
      });
      toast.success("Reply approved", { description: "It is ready to publish." });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve reply");
    } finally {
      setLoading(null);
    }
  }

  async function handlePublish() {
    if (!reply) return;
    setError(null);
    setLoading("publish");
    try {
      await apiCall(`/api/reviews/${review.id}/reply/publish`, "POST", {
        replyId: reply.id,
      });
      toast.success("Published to Google");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish reply");
    } finally {
      setLoading(null);
    }
  }

  /** Approve (if needed) then publish — one click for the common path. */
  async function handleApproveAndPublish() {
    if (!reply) return;
    setError(null);
    setLoading("publish");
    try {
      if (reply.status === "draft" && canApprove) {
        await apiCall(`/api/reviews/${review.id}/reply/approve`, "POST", {
          replyId: reply.id,
        });
      }
      await apiCall(`/api/reviews/${review.id}/reply/publish`, "POST", {
        replyId: reply.id,
      });
      toast.success("Published to Google");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to approve and publish reply"
      );
    } finally {
      setLoading(null);
    }
  }

  async function handleGenerateAI() {
    setError(null);
    setLoading("generate");
    try {
      await apiCall(`/api/reviews/${review.id}/generate`, "POST");
      toast.success("AI draft ready", { description: "Read it and edit before approving." });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate AI response");
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    if (!reply) return;
    setError(null);
    setLoading("delete");
    try {
      await apiCall(`/api/reviews/${review.id}/reply`, "DELETE", {
        replyId: reply.id,
      });
      setDraftContent("");
      toast.success("Draft deleted");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete reply");
    } finally {
      setLoading(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-silver px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-graphite">
            {reviewerName}
          </p>
          <p className="text-xs text-slate">
            {review.location_title}
            {review.client_name && (
              <span className="text-[#c9c7c3]"> · </span>
            )}
            {review.client_name}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="ml-2 shrink-0 text-slate"
          aria-label="Close review detail"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Rating + date row */}
        <div className="flex items-center justify-between">
          <StarDisplay rating={review.star_rating} />
          <span className="text-[11px] text-slate">
            {formatDate(review.review_create_time)}
          </span>
        </div>

        {/* Review text */}
        {review.comment ? (
          <p className="text-base font-light leading-relaxed text-graphite">
            {review.comment}
          </p>
        ) : (
          <p className="text-sm italic text-slate">
            Rating only — no written comment.
          </p>
        )}

        {/* Existing Google reply */}
        {review.google_reply_comment && (
          <div className="rounded-md border border-green-200 bg-green-50/60 px-3 py-2.5">
            <p className="mb-1 text-[11px] font-medium text-green-700">
              Published on Google
              {review.google_reply_update_time && (
                <span className="ml-1 font-normal text-green-600">
                  · {formatDate(review.google_reply_update_time)}
                </span>
              )}
            </p>
            <p className="text-sm leading-relaxed text-green-900">
              {review.google_reply_comment}
            </p>
          </div>
        )}

        {/* Reply status indicator */}
        <div className="flex items-center gap-2">
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", statusConfig.className)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", statusConfig.dotColor)} />
            {statusConfig.label}
          </span>
          {reply?.source === "ai" && (
            <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
              <Sparkles className="h-2.5 w-2.5" aria-hidden />
              AI generated
            </span>
          )}
        </div>

        {loading === "generate" ? (
          <ActivityStatus
            tone="gemini"
            title="Gemini is writing a reply"
            detail="It reads this review and drafts a response inside GRM. Nothing is posted to Google until you approve it."
          />
        ) : null}
        {loading === "publish" ? (
          <ActivityStatus
            tone="google"
            title="Posting this reply on Google"
            detail="Google is publishing it on the Business Profile. Keep this open until it finishes."
          />
        ) : null}
        {loading === "approve" ? (
          <ActivityStatus
            title="Approving this reply"
            detail="It stays in GRM as ready to publish. It is not on Google yet."
          />
        ) : null}
        {loading === "create" || loading === "edit" ? (
          <ActivityStatus
            title="Saving the draft"
            detail="The reply stays in GRM. Publishing to Google is a separate step."
          />
        ) : null}
        {loading === "delete" ? (
          <ActivityStatus
            title="Removing this draft"
            detail="The reply leaves GRM. A reply already on Google is not deleted from there."
          />
        ) : null}

        {/* Error display */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
            <p className="font-medium">Action failed</p>
            <p className="mt-0.5 text-[13px]">{error}</p>
          </div>
        )}

        {/* Reply failure info */}
        {reply?.status === "failed" && reply.last_error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="text-xs font-medium text-red-800">Publishing failed</p>
            <p className="mt-0.5 text-xs text-red-600">{reply.last_error}</p>
            <p className="mt-1 text-[11px] text-red-500">
              You can edit the reply and try publishing again.
            </p>
          </div>
        )}

        {/* ── No reply — show generate + manual options ────────────── */}
        {!reply && !isCreating && review.reply_status === "none" && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={handleGenerateAI}
                disabled={loading === "generate"}
                className="gap-1.5"
              >
                {loading === "generate" ? (
                  <Spinner size="sm" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {loading === "generate" ? "Gemini is writing…" : "Generate AI Response"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreating(true)}
                disabled={loading === "generate"}
                className="gap-1.5"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Write manually
              </Button>
            </div>
            </div>
        )}

        {/* Create form */}
        {isCreating && !reply && (
          <div className="space-y-3">
            <label htmlFor="draft-reply" className="block text-xs font-medium text-slate">
              Draft reply
            </label>
            <Textarea
              id="draft-reply"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder="Write your reply..."
              rows={4}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleCreateDraft}
                disabled={loading === "create" || !draftContent.trim()}
                className="gap-1.5"
              >
                {loading === "create" ? (
                  <Spinner size="sm" />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden />
                )}
                {loading === "create" ? "Saving..." : "Save draft"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsCreating(false);
                  setDraftContent("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Existing reply — display or edit mode */}
        {reply && (
          <div className="space-y-3">
            {isEditing ? (
              <>
                <label htmlFor="edit-reply" className="block text-xs font-medium text-slate">
                  Edit reply
                </label>
                <Textarea
                  id="edit-reply"
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={4}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={loading === "edit" || !draftContent.trim()}
                    className="gap-1.5"
                  >
                    {loading === "edit" ? (
                      <Spinner size="sm" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {loading === "edit" ? "Saving..." : "Save changes"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setDraftContent(reply.content);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className={cn(
                "rounded-md border px-3 py-2.5",
                reply.status === "published"
                  ? "border-green-200 bg-green-50/40"
                  : reply.source === "ai"
                  ? "border-purple-100 bg-purple-50/30"
                  : "border-silver bg-paper/50"
              )}>
                {reply.source === "ai" && reply.status !== "published" && (
                  <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-purple-600">
                    <Sparkles className="h-2.5 w-2.5" aria-hidden />
                    AI-generated draft — review before publishing
                  </p>
                )}
                {reply.status === "published" && (
                  <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-green-600">
                    <CheckCircle2 className="h-2.5 w-2.5" aria-hidden />
                    Published to Google
                    {reply.published_at && (
                      <span className="font-normal text-green-500"> · {formatDate(reply.published_at)}</span>
                    )}
                  </p>
                )}
                <p
                  className={cn(
                    "whitespace-pre-wrap text-sm leading-relaxed text-graphite transition-opacity",
                    loading === "generate" && "opacity-40"
                  )}
                >
                  {reply.content}
                </p>
                {/* Keep primary actions next to the draft so they are not clipped */}
                {reply.status === "draft" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canApprove ? (
                      <>
                        <Button
                          size="sm"
                          onClick={handleApproveAndPublish}
                          disabled={loading !== null}
                          className="gap-1.5"
                        >
                          {loading === "publish" ? (
                            <Spinner size="sm" />
                          ) : (
                            <Send className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {loading === "publish"
                            ? "Posting to Google…"
                            : "Approve & publish"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleApprove}
                          disabled={loading !== null}
                          className="gap-1.5"
                        >
                          {loading === "approve" ? (
                            <Spinner size="sm" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {loading === "approve" ? "Approving..." : "Approve only"}
                        </Button>
                      </>
                    ) : (
                      <p className="w-full text-xs text-slate">
                        An owner or admin needs to approve this draft before it can be published.
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDraftContent(reply.content);
                        setIsEditing(true);
                        setError(null);
                      }}
                      className="gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleGenerateAI}
                      disabled={loading !== null}
                      className="gap-1.5"
                    >
                      {loading === "generate" ? (
                        <Spinner size="sm" />
                      ) : (
                        <RotateCw className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {loading === "generate" ? "Gemini is writing…" : "Regenerate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-slate hover:text-red-600"
                      onClick={handleDelete}
                      disabled={loading !== null}
                      aria-label="Reject draft"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                )}
                {reply.status === "approved" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={handlePublish}
                      disabled={loading !== null}
                      className="gap-1.5"
                    >
                      {loading === "publish" ? (
                        <Spinner size="sm" />
                      ) : (
                        <Send className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {loading === "publish" ? "Posting to Google…" : "Publish to Google"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDraftContent(reply.content);
                        setIsEditing(true);
                        setError(null);
                      }}
                      className="gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-slate hover:text-red-600"
                      onClick={handleDelete}
                      disabled={loading !== null}
                      aria-label="Reject draft"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                )}
                {reply.status === "failed" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={handlePublish}
                      disabled={loading !== null}
                      className="gap-1.5"
                    >
                      {loading === "publish" ? (
                        <Spinner size="sm" />
                      ) : (
                        <Send className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {loading === "publish" ? "Posting to Google…" : "Retry publish"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDraftContent(reply.content);
                        setIsEditing(true);
                        setError(null);
                      }}
                      className="gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
