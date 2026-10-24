"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Pencil,
  AlertCircle,
  Clock,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ActivityStatus } from "@/components/activity-status";
import dynamic from "next/dynamic";
import { SelectField } from "@/components/ui/select-field";
import { Spinner } from "@/components/ui/spinner";
import { languageLabel, themeLabel, workflowState } from "@/lib/review-inbox";
import type { ResolutionContact } from "@/lib/resolution-contact";
import { useServerRefresh, useSettleWhenUpdated } from "@/hooks/use-server-refresh";
import { ACTION_STATUS } from "@/lib/ui-status";
import { pollBulkJob } from "@/lib/bulk-job-client";

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
  group_name?: string | null;
  review_language?: string | null;
  complaint_theme?: string | null;
  assigned_to?: string | null;
  reopened_at?: string | null;
  notes?: Array<{ id: string; body: string; createdAt: string; authorId: string }>;
  activity?: Array<{ at: string; label: string }>;
}

interface ReplyItem {
  id: string;
  content: string;
  source: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  approved_by?: string | null;
  published_at: string | null;
  last_error: string | null;
  failure_count: number;
}

interface ReviewListProps {
  reviews: ReviewItem[];
  replies: Record<string, ReplyItem>;
  canApprove: boolean;
  /** Members generate with AI and publish only after approval. They cannot type the reply. */
  aiOnly?: boolean;
  contact?: ResolutionContact;
  members?: Array<{ id: string; email: string }>;
}

type BulkAction = "generate" | "approve" | "publish" | "discard" | "assign";

// The detail panel (1,200+ lines) only appears when a review is opened, so
// it loads on demand instead of riding in the inbox bundle.
const ReviewDetailPanel = dynamic(
  () => import("@/components/review-detail-panel").then((m) => m.ReviewDetailPanel),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center p-8">
        <Spinner />
      </div>
    ),
  }
);

const STATUS_CONFIG: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  published:       { label: "Published", className: "bg-paper text-ink",  Icon: CheckCircle2 },
  approved:        { label: "Ready",  className: "bg-ink text-white",   Icon: CheckCircle2 },
  draft:           { label: "Draft",     className: "bg-paper text-slate border border-silver",   Icon: Pencil },
  failed:          { label: "Failed",    className: "bg-[#fce8e6] text-destructive",    Icon: AlertCircle },
  pending_publish: { label: "Publishing", className: "bg-paper text-ink", Icon: Clock },
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

type ReplyPatch = { status: string; reply: ReplyItem | null };

export function ReviewList({ reviews, replies, canApprove, aiOnly = false, contact, members = [] }: ReviewListProps) {
  const { pending: refreshing, refresh, settle } = useServerRefresh();
  useSettleWhenUpdated(refreshing, settle, reviews);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState<BulkAction | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [patches, setPatches] = useState<Record<string, ReplyPatch>>({});
  const [inboxRevision, setInboxRevision] = useState(0);
  const serverReviews = useRef(reviews);

  useEffect(() => {
    if (serverReviews.current === reviews) return;
    serverReviews.current = reviews;
    setInboxRevision((revision) => revision + 1);
  }, [reviews]);

  const viewReviews = useMemo(
    () =>
      reviews.map((review) => {
        const patch = patches[review.id];
        return patch ? { ...review, reply_status: patch.status } : review;
      }),
    [reviews, patches]
  );
  const viewReplies = useMemo(() => {
    const next = { ...replies };
    for (const [id, patch] of Object.entries(patches)) {
      if (patch.reply) next[id] = patch.reply;
      else delete next[id];
    }
    return next;
  }, [replies, patches]);

  const selectedReview = viewReviews.find((r) => r.id === selectedId) ?? null;
  const selectedReply = selectedId ? (viewReplies[selectedId] ?? null) : null;

  // Keep the open review mounted from its last known copy when a refresh drops
  // it from the filtered list — a fresh draft leaves "Needs reply", and the
  // modal must stay open so the user can approve or publish next.
  const lastSelectedRef = useRef<{ review: ReviewItem; reply: ReplyItem | null } | null>(null);
  useEffect(() => {
    if (!selectedId) {
      lastSelectedRef.current = null;
      return;
    }
    if (selectedReview) {
      lastSelectedRef.current = { review: selectedReview, reply: selectedReply };
    }
  }, [selectedId, selectedReview, selectedReply]);

  const panelReview =
    selectedReview ??
    (selectedId && lastSelectedRef.current?.review.id === selectedId
      ? lastSelectedRef.current.review
      : null);
  const panelReply = selectedId
    ? (viewReplies[selectedId] ?? lastSelectedRef.current?.reply ?? null)
    : null;

  useEffect(() => {
    setPatches((current) => {
      let changed = false;
      const next = { ...current };
      for (const [id, patch] of Object.entries(current)) {
        const server = reviews.find((review) => review.id === id);
        const serverReply = replies[id];
        const statusOk = server?.reply_status === patch.status;
        const replyOk = patch.reply
          ? serverReply?.id === patch.reply.id && serverReply.content === patch.reply.content
          : !serverReply;
        if (statusOk && replyOk) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [reviews, replies]);

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
    viewReviews.length > 0 && viewReviews.every((r) => checked[r.id]);

  function toggleAll(next: boolean) {
    const nextMap: Record<string, boolean> = {};
    for (const r of viewReviews) nextMap[r.id] = next;
    setChecked(nextMap);
  }

  async function runBulk(action: BulkAction, extra?: { assigneeId: string | null }) {
    if (selectedIds.length === 0) return;
    setBulkError(null);
    setBulkLoading(action);
    try {
      const response = await fetch("/api/reviews/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewIds: selectedIds, ...extra }),
      });
      let data = (await response.json()) as {
        error?: string;
        jobId?: string;
        succeeded?: number;
        failed?: number;
        results?: Array<{
          reviewId?: string;
          ok: boolean;
          error?: string;
          replyId?: string;
          content?: string;
        }>;
      };
      if (!response.ok) {
        setBulkError(data.error ?? "Bulk action failed");
        return;
      }
      // Generate/publish run as a queued job: wait for its real results.
      if (data.jobId) {
        const final = await pollBulkJob(data.jobId);
        if (final.status !== "done") {
          setBulkError(final.error ?? "That bulk action did not finish. Check the reviews and try again.");
          return;
        }
        data = { ...data, succeeded: final.succeeded, failed: final.failed, results: final.results };
      }
      const verb = {
        generate: "drafted",
        approve: "approved",
        publish: "published",
        discard: "discarded",
        assign: "assigned",
      }[action];
      const ok = data.succeeded ?? 0;
      const bad = data.failed ?? 0;
      const firstError = data.results?.find((item) => !item.ok)?.error;
      if (bad > 0) {
        toast.warning(`${ok} ${verb}, ${bad} failed`, {
          description: firstError ?? "Some selected reviews were not in a state that allows this.",
        });
      } else {
        toast.success(`${ok} review${ok === 1 ? "" : "s"} ${verb}`);
      }
      const failedIds = new Set(
        (data.results ?? []).filter((item) => !item.ok && item.reviewId).map((item) => item.reviewId as string)
      );
      if (action === "generate") {
        const drafted: Record<string, ReplyPatch> = {};
        for (const item of data.results ?? []) {
          if (!item.ok || !item.reviewId || !item.replyId || !item.content) continue;
          drafted[item.reviewId] = {
            status: "draft",
            reply: {
              id: item.replyId,
              content: item.content,
              source: "ai",
              status: "draft",
              created_at: new Date().toISOString(),
              approved_at: null,
              published_at: null,
              last_error: null,
              failure_count: 0,
            },
          };
        }
        if (Object.keys(drafted).length > 0) {
          setPatches((prev) => ({ ...prev, ...drafted }));
        }
      } else if (action === "approve" || action === "publish" || action === "discard") {
        const status = action === "approve" ? "approved" : action === "publish" ? "published" : "none";
        setPatches((prev) => {
          const next = { ...prev };
          for (const id of selectedIds) {
            if (failedIds.has(id)) continue;
            const existing = prev[id]?.reply ?? replies[id] ?? null;
            if (status === "none") {
              next[id] = { status, reply: null };
            } else if (existing) {
              next[id] = {
                status,
                reply: {
                  ...existing,
                  status,
                  approved_at: status === "approved" ? new Date().toISOString() : existing.approved_at,
                  published_at: status === "published" ? new Date().toISOString() : existing.published_at,
                },
              };
            }
          }
          return next;
        });
      }
      setChecked({});
      refresh();
    } catch {
      setBulkError("Unable to run bulk action");
    } finally {
      setBulkLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl bg-white shadow-card px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4">
        <label className="flex items-center gap-2 text-sm text-graphite">
          <Checkbox
            checked={allChecked}
            onCheckedChange={(checked) => toggleAll(checked)}
            aria-label="Select all on page"
          />
          Select all on page
        </label>
        <span className="text-sm text-slate">
          {selectedIds.length} selected
        </span>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          <Button
            size="xs"
            variant="outline"
            disabled={selectedIds.length === 0 || bulkLoading !== null}
            onClick={() => runBulk("generate")}
            className="gap-1"
          >
            {bulkLoading === "generate" ? (
              <Spinner size="xs" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {bulkLoading === "generate" ? "Gemini is writing…" : "AI draft"}
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
          {canApprove ? (
          <Button
            size="xs"
            disabled={selectedIds.length === 0 || bulkLoading !== null}
            onClick={() => runBulk("publish")}
            loading={bulkLoading === "publish"}
          >
            {bulkLoading === "publish" ? "Posting to Google…" : "Approve & publish"}
          </Button>
          ) : null}
          {!aiOnly && members.length > 0 ? (
            <>
              <SelectField
                label="Assign selected"
                value={assigneeId}
                options={[
                  { value: "", label: "Assign to…" },
                  { value: "unassigned", label: "Unassigned" },
                  ...members.map((member) => ({ value: member.id, label: member.email })),
                ]}
                onValueChange={setAssigneeId}
                disabled={selectedIds.length === 0 || bulkLoading !== null}
                className="w-44"
                size="sm"
              />
              <Button
                size="xs"
                variant="outline"
                disabled={selectedIds.length === 0 || !assigneeId || bulkLoading !== null}
                onClick={() =>
                  runBulk("assign", {
                    assigneeId: assigneeId === "unassigned" ? null : assigneeId,
                  })
                }
              >
                Assign
              </Button>
            </>
          ) : null}
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

      {bulkLoading === "generate" ? (
        <ActivityStatus
          tone="gemini"
          title="Generating AI replies…"
          detail={`Drafting ${selectedIds.length} selected ${selectedIds.length === 1 ? "reply" : "replies"} one at a time, using your organisation's saved guidelines. Nothing is posted to Google until someone approves.`}
        />
      ) : refreshing ? (
        <ActivityStatus
          title={ACTION_STATUS.applying.title}
          detail="New drafts are already on the cards. The saved inbox is catching up."
        />
      ) : null}
      {bulkLoading === "approve" ? (
        <ActivityStatus
          title="Approving the selected drafts…"
          detail="Approved replies are ready to publish. They are not on Google yet."
        />
      ) : null}
      {bulkLoading === "publish" ? (
        <ActivityStatus
          tone="google"
          title="Submitting replies…"
          detail="Sending each approved reply to Google Business Profile."
        />
      ) : null}
      {bulkLoading === "discard" ? (
        <ActivityStatus
          title="Removing the selected drafts"
          detail="These drafts leave GRM. Replies already on Google stay there."
        />
      ) : null}

      {bulkError && (
        <p className="text-xs text-red-600" role="alert">
          {bulkError}
        </p>
      )}

      <div
        className="grid gap-3 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3"
        role="list"
        aria-label="Reviews"
      >
        {viewReviews.map((review) => {
          const isActive = review.id === selectedId;
          const reply = viewReplies[review.id];
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
                "flex flex-col rounded-xl border bg-white p-5 text-left transition-colors",
                isActive
                  ? "border-ink bg-paper/40"
                  : "border-silver hover:border-ink"
              )}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={!!checked[review.id]}
                  onCheckedChange={(checked) =>
                    setChecked((prev) => ({
                      ...prev,
                      [review.id]: checked,
                    }))
                  }
                  onClick={(e) => e.stopPropagation()}
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
                    <p className="truncate text-sm font-medium text-graphite">
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
                  <p className="mt-0.5 text-xs font-light text-slate">
                    {formatFriendlyDateTime(review.review_create_time)}
                    {" · "}
                    {review.location_title}
                    {review.group_name ? ` · ${review.group_name}` : ""}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedId(review.id)}
                className="mt-4 flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10"
                aria-label={`Open review by ${name}`}
              >
                <StarRating rating={review.star_rating} />
                <p className="mt-3 line-clamp-4 text-sm font-light leading-relaxed text-graphite sm:line-clamp-5 sm:min-h-[7.5rem]">
                  {review.comment || "Rating only — no written comment."}
                </p>
              </button>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-medium text-graphite">
                  {workflowState({
                    replyStatus: review.reply_status,
                    starRating: review.star_rating,
                    reopenedAt: review.reopened_at ?? null,
                    hasGoogleReply: hasGoogleReply,
                  }).label}
                </span>
                {languageLabel(review.review_language) ? (
                  <span className="text-[11px] text-slate">{languageLabel(review.review_language)}</span>
                ) : null}
                {themeLabel(review.complaint_theme) ? (
                  <span className="text-[11px] text-slate">{themeLabel(review.complaint_theme)}</span>
                ) : null}
                {review.assigned_to ? (
                  <span className="text-[11px] text-slate">
                    {members.find((member) => member.id === review.assigned_to)?.email ?? "Assigned"}
                  </span>
                ) : null}
                {hasGoogleReply && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#e6f4ea] px-2.5 py-1 text-[11px] font-medium text-success">
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
              </div>
            </article>
          );
        })}
      </div>

      {panelReview && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-graphite/45 sm:items-center sm:p-6"
          role="presentation"
          onClick={() => setSelectedId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Review by ${panelReview.reviewer_display_name || "reviewer"}`}
            className="flex h-dvh w-full max-w-2xl flex-col overflow-hidden bg-white sm:h-[min(92dvh,860px)] sm:rounded-xl sm:border sm:border-silver"
            onClick={(event) => event.stopPropagation()}
          >
            <ReviewDetailPanel
              review={panelReview}
              reply={panelReply}
              canApprove={canApprove}
              aiOnly={aiOnly}
              contact={contact}
              members={members}
              onClose={() => setSelectedId(null)}
              inboxRevision={inboxRevision}
              onDraft={(reviewId, next) => {
                setPatches((prev) => ({
                  ...prev,
                  [reviewId]: { status: "draft", reply: next },
                }));
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
