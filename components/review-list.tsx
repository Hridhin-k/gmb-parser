"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MessageSquare, Sparkles, Trash2, UserPlus } from "lucide-react";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ActivityStatus } from "@/components/activity-status";
import { ConfirmDialog } from "@/components/confirm-dialog";
import dynamic from "next/dynamic";
import { SelectField } from "@/components/ui/select-field";
import { Spinner } from "@/components/ui/spinner";
import { languageLabel, themeLabel } from "@/lib/review-inbox";
import { splitGoogleTranslation } from "@/lib/review-text";
import type { ResolutionContact } from "@/lib/resolution-contact";
import { useServerRefresh, useSettleWhenUpdated } from "@/hooks/use-server-refresh";
import { ACTION_STATUS } from "@/lib/ui-status";
import { pollBulkJob } from "@/lib/bulk-job-client";
import { InlineStars, ReviewStateBadges, reviewStateBadges } from "@/components/reviews-badges";

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
  /** Sort control rendered in the list header. */
  sortControl?: React.ReactNode;
  /** "1–50 of 142" for the list header. */
  rangeLabel?: string;
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

type ReplyPatch = { status: string; reply: ReplyItem | null };

function reviewerName(review: ReviewItem): string {
  return review.reviewer_is_anonymous ? "Anonymous" : review.reviewer_display_name || "Unknown reviewer";
}

/** Drop local patches the server has caught up with. */
function prunePatches(
  current: Record<string, ReplyPatch>,
  reviews: ReviewItem[],
  replies: Record<string, ReplyItem>
): Record<string, ReplyPatch> {
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
}

export function ReviewList({
  reviews,
  replies,
  canApprove,
  aiOnly = false,
  contact,
  members = [],
  sortControl,
  rangeLabel,
}: ReviewListProps) {
  const { pending: refreshing, refresh, settle } = useServerRefresh();
  useSettleWhenUpdated(refreshing, settle, reviews);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState<BulkAction | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [patches, setPatches] = useState<Record<string, ReplyPatch>>({});
  const [confirmBulk, setConfirmBulk] = useState<"generate" | "discard" | null>(null);
  const [panelDirty, setPanelDirty] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<{ id: string | null } | null>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // A new server payload: bump the inbox revision (the panel settles on it)
  // and forget local patches the server now reflects.
  const [serverPayload, setServerPayload] = useState({ reviews, replies });
  const [inboxRevision, setInboxRevision] = useState(0);
  if (serverPayload.reviews !== reviews || serverPayload.replies !== replies) {
    if (serverPayload.reviews !== reviews) setInboxRevision((revision) => revision + 1);
    setServerPayload({ reviews, replies });
    setPatches((current) => prunePatches(current, reviews, replies));
  }

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

  const selectedIndex = selectedId ? viewReviews.findIndex((r) => r.id === selectedId) : -1;
  const selectedReview = selectedIndex >= 0 ? viewReviews[selectedIndex]! : null;
  const selectedReply = selectedId ? (viewReplies[selectedId] ?? null) : null;

  // Keep the open review mounted from its last known copy when a refresh drops
  // it from the filtered list — a fresh draft leaves "Needs reply", and the
  // drawer must stay open so the user can approve or publish next.
  const [lastSelected, setLastSelected] = useState<{ review: ReviewItem; reply: ReplyItem | null } | null>(null);
  if (selectedReview && (lastSelected?.review !== selectedReview || lastSelected.reply !== selectedReply)) {
    setLastSelected({ review: selectedReview, reply: selectedReply });
  }

  const panelReview =
    selectedReview ??
    (selectedId && lastSelected?.review.id === selectedId ? lastSelected.review : null);
  const panelReply = selectedId ? (viewReplies[selectedId] ?? lastSelected?.reply ?? null) : null;

  /** Change the open review, asking first when the drawer has unsaved edits. */
  function requestSelect(id: string | null) {
    if (id === selectedId) return;
    if (panelDirty && selectedId) {
      setPendingTarget({ id });
      return;
    }
    setSelectedId(id);
  }

  useEffect(() => {
    if (!selectedId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || pendingTarget) return;
      if (panelDirty) setPendingTarget({ id: null });
      else setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, panelDirty, pendingTarget]);

  // Move focus into the drawer when a review opens (keyboard and screen readers).
  useEffect(() => {
    if (selectedId) drawerRef.current?.focus({ preventScroll: true });
  }, [selectedId]);

  const selectedIds = useMemo(
    () => Object.entries(checked).filter(([, v]) => v).map(([id]) => id),
    [checked]
  );
  const selectedCount = selectedIds.length;

  const allChecked = viewReviews.length > 0 && viewReviews.every((r) => checked[r.id]);
  const someChecked = selectedCount > 0 && !allChecked;

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

  const busy = bulkLoading !== null;
  const countLabel = (noun: string, plural = `${noun}s`) => `${selectedCount} ${selectedCount === 1 ? noun : plural}`;
  const drawerOpen = Boolean(panelReview);

  return (
    <div className={cn(drawerOpen && "xl:grid xl:grid-cols-[minmax(0,1fr)_540px] xl:items-start xl:gap-4")}>
      <div className="min-w-0 space-y-3">
        <section aria-label="Reviews" className="overflow-hidden rounded-lg border border-line bg-white">
          {selectedCount === 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-xs text-ink-3">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={false}
                  onCheckedChange={(next) => toggleAll(next)}
                  aria-label="Select all reviews on this page"
                />
                Select page
              </label>
              {rangeLabel ? <span className="tabular-nums">{rangeLabel}</span> : null}
              <span className="ml-auto">{sortControl}</span>
            </div>
          ) : (
            <div
              className="flex flex-wrap items-center gap-x-2.5 gap-y-2 bg-ink px-3 py-2 text-[13px] text-white"
              role="toolbar"
              aria-label="Bulk actions"
            >
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked}
                onCheckedChange={(next) => toggleAll(someChecked ? true : next)}
                aria-label={allChecked ? "Deselect all reviews on this page" : "Select all reviews on this page"}
                className="border-white"
              />
              <b className="font-semibold tabular-nums" aria-live="polite">
                {selectedCount} selected
              </b>
              <span className="text-xs text-[#afb7c6]">
                on this page ·{" "}
                <button type="button" className="text-[#afc2f7] hover:underline" onClick={() => setChecked({})}>
                  Clear selection
                </button>
              </span>
              <span className="flex-1" />
              {!aiOnly && members.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  <SelectField
                    label="Assign selected reviews to"
                    value={assigneeId}
                    options={[
                      { value: "", label: "Assign to…" },
                      { value: "unassigned", label: "Unassigned" },
                      ...members.map((member) => ({ value: member.id, label: member.email })),
                    ]}
                    onValueChange={setAssigneeId}
                    disabled={busy}
                    className="w-40 text-ink"
                    size="sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!assigneeId || busy}
                    loading={bulkLoading === "assign"}
                    onClick={() =>
                      runBulk("assign", {
                        assigneeId: assigneeId === "unassigned" ? null : assigneeId,
                      })
                    }
                  >
                    <UserPlus aria-hidden />
                    Assign {selectedCount}
                  </Button>
                </span>
              ) : null}
              {canApprove ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  loading={bulkLoading === "approve"}
                  onClick={() => runBulk("approve")}
                >
                  Approve {countLabel("draft")}
                </Button>
              ) : null}
              {canApprove ? (
                <Button size="sm" disabled={busy} onClick={() => runBulk("publish")} loading={bulkLoading === "publish"}>
                  {bulkLoading === "publish" ? "Posting to Google…" : `Approve & publish ${selectedCount}`}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ai"
                disabled={busy}
                loading={bulkLoading === "generate"}
                onClick={() => setConfirmBulk("generate")}
              >
                <Sparkles aria-hidden />
                {bulkLoading === "generate" ? "AI is writing…" : `Generate ${countLabel("draft")}`}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                loading={bulkLoading === "discard"}
                onClick={() => setConfirmBulk("discard")}
              >
                <Trash2 aria-hidden />
                Reject drafts
              </Button>
            </div>
          )}

          <ul className="divide-y divide-line-2">
            {viewReviews.map((review) => {
              const isActive = review.id === selectedId;
              const reply = viewReplies[review.id];
              const hasGoogleReply = !!review.google_reply_comment;
              const name = reviewerName(review);
              const text = review.comment ? splitGoogleTranslation(review.comment).original : null;
              const language = languageLabel(review.review_language);
              const theme = themeLabel(review.complaint_theme);
              const assignee = review.assigned_to
                ? (members.find((member) => member.id === review.assigned_to)?.email ?? "Assigned")
                : null;
              const badges = reviewStateBadges({
                replyStatus: review.reply_status,
                starRating: review.star_rating,
                reopenedAt: review.reopened_at ?? null,
                hasGoogleReply,
                source: reply?.source,
              });

              return (
                <li
                  key={review.id}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "grid grid-cols-[16px_minmax(0,1fr)] gap-3 px-4 py-3 transition-colors",
                    isActive
                      ? "bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)]"
                      : checked[review.id]
                        ? "bg-[#fafbfd]"
                        : "hover:bg-[#fafbfd]"
                  )}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={!!checked[review.id]}
                    onCheckedChange={(next) =>
                      setChecked((prev) => ({
                        ...prev,
                        [review.id]: next,
                      }))
                    }
                    aria-label={`Select review by ${name}`}
                  />
                  <button
                    type="button"
                    onClick={() => requestSelect(review.id)}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-line"
                    aria-label={`Open review by ${name}, ${review.star_rating} stars`}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
                        <InlineStars rating={review.star_rating} />
                        <b className="font-semibold text-ink">{name}</b>
                        <span className="truncate">{review.location_title}</span>
                        <span>{formatFriendlyDateTime(review.review_create_time)}</span>
                        {language ? <span>{language}</span> : null}
                      </span>
                      <span
                        className={cn(
                          "mt-1 mb-1.5 line-clamp-2 text-[13px] leading-relaxed",
                          text ? "text-ink-2" : "italic text-ink-3"
                        )}
                      >
                        {text || "Rating only. No written comment."}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <ReviewStateBadges badges={badges} />
                        {theme ? <Badge variant="outline">{theme}</Badge> : null}
                        {hasGoogleReply && review.reply_status !== "published" ? (
                          <Badge variant="ok">
                            <MessageSquare aria-hidden />
                            On Google
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                    <span className="hidden max-w-[180px] flex-col items-end gap-1.5 text-right text-xs text-ink-3 sm:flex">
                      <span className="max-w-full truncate">{assignee ?? "Unassigned"}</span>
                      {review.group_name || review.client_name ? (
                        <span className="max-w-full truncate">{review.group_name ?? review.client_name}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {bulkLoading === "generate" ? (
          <ActivityStatus
            tone="ai"
            title={`Generating ${countLabel("AI reply", "AI replies")}…`}
            detail="Drafting one at a time with your business's saved reply guidelines. Nothing is posted to Google until someone approves."
          />
        ) : refreshing ? (
          <ActivityStatus
            title={ACTION_STATUS.applying.title}
            detail="New drafts are already on the rows. The saved list is catching up."
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
            detail="These drafts are deleted here. Replies already on Google stay there."
          />
        ) : null}

        {bulkError ? (
          <Banner tone="bad" title="The bulk action did not finish.">
            {bulkError}
          </Banner>
        ) : null}
      </div>

      {panelReview ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-ink/30 xl:hidden"
            role="presentation"
            onClick={() => requestSelect(null)}
          />
          <aside
            ref={drawerRef}
            tabIndex={-1}
            aria-label={`Review by ${reviewerName(panelReview)}`}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden border-l border-line bg-white outline-none sm:w-[540px] xl:sticky xl:top-4 xl:z-auto xl:h-[calc(100dvh-88px)] xl:w-auto xl:rounded-lg xl:border"
          >
            <ReviewDetailPanel
              key={panelReview.id}
              review={panelReview}
              reply={panelReply}
              canApprove={canApprove}
              aiOnly={aiOnly}
              contact={contact}
              members={members}
              onClose={() => requestSelect(null)}
              onPrev={selectedIndex > 0 ? () => requestSelect(viewReviews[selectedIndex - 1]!.id) : undefined}
              onNext={
                selectedIndex >= 0 && selectedIndex < viewReviews.length - 1
                  ? () => requestSelect(viewReviews[selectedIndex + 1]!.id)
                  : undefined
              }
              onDirtyChange={setPanelDirty}
              inboxRevision={inboxRevision}
              onDraft={(reviewId, next) => {
                setPatches((prev) => ({
                  ...prev,
                  [reviewId]: { status: "draft", reply: next },
                }));
              }}
            />
          </aside>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmBulk === "generate"}
        onOpenChange={(open) => setConfirmBulk(open ? "generate" : null)}
        title={`Generate ${countLabel("draft")}?`}
        description="Each draft uses your saved reply guidelines and is saved as an AI draft for approval. Nothing is published. This uses your AI budget. A draft someone has edited by hand is kept as it is."
        confirmLabel={`Generate ${countLabel("draft")}`}
        onConfirm={() => {
          void runBulk("generate");
        }}
      />
      <ConfirmDialog
        open={confirmBulk === "discard"}
        onOpenChange={(open) => setConfirmBulk(open ? "discard" : null)}
        title={`Reject drafts on ${countLabel("review")}?`}
        description="Drafts and approved replies on the selected reviews are deleted here. Replies already on Google stay on Google."
        confirmLabel="Reject drafts"
        tone="danger"
        onConfirm={() => {
          void runBulk("discard");
        }}
      />
      <ConfirmDialog
        open={pendingTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTarget(null);
        }}
        title="Discard your edits to this reply?"
        description="You changed the reply but have not saved it. Cancel to keep editing, or discard the changes."
        confirmLabel="Discard edits"
        tone="danger"
        onConfirm={() => {
          const target = pendingTarget;
          setPanelDirty(false);
          setPendingTarget(null);
          if (target) setSelectedId(target.id);
        }}
      />
    </div>
  );
}
