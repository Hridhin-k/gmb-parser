"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  X,
  Send,
  CheckCircle2,
  Pencil,
  Sparkles,
  Trash2,
  RotateCw,
} from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { ActivityStatus } from "@/components/activity-status";
import { Spinner } from "@/components/ui/spinner";
import { SelectField } from "@/components/ui/select-field";
import { Input } from "@/components/ui/input";
import { languageLabel, themeLabel, workflowState } from "@/lib/review-inbox";
import { splitGoogleTranslation } from "@/lib/review-text";
import { REPLY_LANGUAGES, REPLY_TEMPLATES } from "@/lib/reply-adjustments";
import {
  insertResolutionContact,
  resolutionContactSentence,
  type ResolutionContact,
  type ResolutionContactKind,
} from "@/lib/resolution-contact";
import { useServerRefresh, useSettleWhenUpdated } from "@/hooks/use-server-refresh";
import { pollAiGeneration, retryAiGeneration } from "@/lib/ai-generation-client";
import { ACTION_STATUS } from "@/lib/ui-status";

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
  group_name?: string | null;
  review_language?: string | null;
  complaint_theme?: string | null;
  assigned_to?: string | null;
  reopened_at?: string | null;
  notes?: Array<{ id: string; body: string; createdAt: string; authorId: string }>;
  activity?: Array<{ at: string; label: string }>;
}

interface ReplyForPanel {
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

interface ReviewDetailPanelProps {
  review: ReviewForPanel;
  reply: ReplyForPanel | null;
  canApprove: boolean;
  contact?: ResolutionContact;
  members?: Array<{ id: string; email: string }>;
  onClose: () => void;
  /** Paint the new draft on the inbox card without waiting for a page refresh. */
  onDraft?: (reviewId: string, reply: ReplyForPanel) => void;
  /** Changes only when the server inbox payload changes, not when a draft is painted locally. */
  inboxRevision?: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  return formatFriendlyDateTime(iso, "2-digit");
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
  reply: serverReply,
  canApprove,
  contact = { phone: null, email: null },
  members = [],
  onClose,
  onDraft,
  inboxRevision = 0,
}: ReviewDetailPanelProps) {
  const { pending: refreshing, refresh, settle } = useServerRefresh();
  useSettleWhenUpdated(refreshing, settle, inboxRevision);
  const [liveReply, setLiveReply] = useState<ReplyForPanel | null | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [saveJob, setSaveJob] = useState<{
    jobId: string;
    status: "saving" | "failed";
    content: string;
  } | null>(null);
  const draftSaving = saveJob?.status === "saving";
  const reply = liveReply === undefined ? serverReply : liveReply;
  const replyStatus = liveStatus ?? review.reply_status;
  const [draftContent, setDraftContent] = useState(serverReply?.content ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(review.assigned_to ?? "");
  const [note, setNote] = useState("");
  const [replyLanguage, setReplyLanguage] = useState("");
  const [templateId, setTemplateId] = useState("");
  const reviewText = review.comment ? splitGoogleTranslation(review.comment) : null;

  function addContact(kind: ResolutionContactKind) {
    const sentence = resolutionContactSentence(kind, contact);
    if (!sentence) return;
    const base = isEditing || isCreating ? draftContent : (reply?.content ?? "");
    setDraftContent(insertResolutionContact(base, sentence));
    if (reply) setIsEditing(true);
    else setIsCreating(true);
    setError(null);
  }

  useEffect(() => {
    setLiveReply(undefined);
    setSaveJob(null);
    setLiveStatus(null);
    setDraftContent(serverReply?.content ?? "");
    setIsEditing(false);
    setIsCreating(false);
    // Only when the open review changes. A later server payload must not wipe a newer draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.id]);

  useEffect(() => {
    setLiveReply((current) => {
      if (current === undefined) return current;
      if (current === null) return serverReply ? current : undefined;
      if (
        serverReply &&
        serverReply.id === current.id &&
        serverReply.content === current.content &&
        serverReply.status === current.status
      ) {
        return undefined;
      }
      return current;
    });
    setLiveStatus((current) => (current && review.reply_status === current ? null : current));
  }, [serverReply, review.reply_status]);

  const workflow = workflowState({
    replyStatus,
    starRating: review.star_rating,
    reopenedAt: review.reopened_at ?? null,
    hasGoogleReply: Boolean(review.google_reply_comment),
  });

  const reviewerName = review.reviewer_is_anonymous
    ? "Anonymous"
    : (review.reviewer_display_name || "Unknown reviewer");

  const statusConfig = REPLY_STATUS_MAP[replyStatus] ?? REPLY_STATUS_MAP.none;

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
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create reply");
    } finally {
      setLoading(null);
    }
  }

  async function handleSaveEdit() {
    if (!reply || !draftContent.trim()) return;
    if (blockWhileSaving()) return;
    setError(null);
    setLoading("edit");
    try {
      await apiCall(`/api/reviews/${review.id}/reply`, "PUT", {
        replyId: reply.id,
        content: draftContent.trim(),
      });
      setIsEditing(false);
      toast.success(
        reply.status === "published"
          ? "Draft saved. The reply on Google stays as it is until you publish this version."
          : "Changes saved"
      );
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save edit");
    } finally {
      setLoading(null);
    }
  }

  async function handleApprove() {
    if (!reply) return;
    if (blockWhileSaving()) return;
    setError(null);
    setLoading("approve");
    try {
      await apiCall(`/api/reviews/${review.id}/reply/approve`, "POST", {
        replyId: reply.id,
      });
      toast.success("Reply approved", { description: "It is ready to publish." });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve reply");
    } finally {
      setLoading(null);
    }
  }

  async function handlePublish() {
    if (!reply) return;
    if (blockWhileSaving()) return;
    setError(null);
    setLoading("publish");
    try {
      await apiCall(`/api/reviews/${review.id}/reply/publish`, "POST", {
        replyId: reply.id,
      });
      toast.success("Published to Google");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish reply");
    } finally {
      setLoading(null);
    }
  }

  /** Approve (if needed) then publish — one click for the common path. */
  async function handleApproveAndPublish() {
    if (!reply) return;
    if (blockWhileSaving()) return;
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
      refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to approve and publish reply"
      );
    } finally {
      setLoading(null);
    }
  }

  function blockRewrite(): boolean {
    if (isEditing) {
      setError("Save or cancel your edits before replacing the draft.");
      return true;
    }
    return false;
  }

  function blockWhileSaving(): boolean {
    if (draftSaving) {
      setError("Your new draft is still saving. Give it a second, then try again.");
      return true;
    }
    return false;
  }

  /** Watches the background save; swaps the provisional reply id for the real one. */
  function watchSave(jobId: string, content: string) {
    void pollAiGeneration(jobId).then((result) => {
      if (result.status === "saved") {
        setSaveJob(null);
        if (result.replyId) {
          const real: ReplyForPanel = {
            id: result.replyId,
            content,
            source: "ai",
            status: "draft",
            created_at: new Date().toISOString(),
            approved_at: null,
            published_at: null,
            last_error: null,
            failure_count: 0,
          };
          setLiveReply(real);
          onDraft?.(review.id, real);
        }
        refresh();
      } else {
        setSaveJob({ jobId, status: "failed", content });
      }
    });
  }

  async function handleRetrySave() {
    if (!saveJob) return;
    const { jobId, content } = saveJob;
    setSaveJob({ jobId, status: "saving", content });
    const started = await retryAiGeneration(jobId);
    if (!started) {
      setSaveJob({ jobId, status: "failed", content });
      return;
    }
    watchSave(jobId, content);
  }

  async function handleGenerateAI(body?: object) {
    if (blockWhileSaving()) return;
    if (reply && blockRewrite()) return;
    const adjustment =
      body && typeof body === "object" && !(body instanceof Event) ? body : undefined;
    setError(null);
    setLoading("generate");
    try {
      const data = (await apiCall(
        `/api/reviews/${review.id}/generate`,
        "POST",
        adjustment ?? (reply ? { adjustment: "regenerate", replaceEdited: true } : undefined)
      )) as { replyId?: string; content?: string; jobId?: string | null };
      if (data.content && data.replyId) {
        const next: ReplyForPanel = {
          id: data.replyId,
          content: data.content,
          source: "ai",
          status: "draft",
          created_at: new Date().toISOString(),
          approved_at: null,
          published_at: null,
          last_error: null,
          failure_count: 0,
        };
        setLiveReply(next);
        setLiveStatus("draft");
        setDraftContent(data.content);
        setIsEditing(false);
        setIsCreating(false);
        onDraft?.(review.id, next);
        if (data.jobId) {
          setSaveJob({ jobId: data.jobId, status: "saving", content: data.content });
          watchSave(data.jobId, data.content);
        }
      }
      toast.success("AI draft ready", { description: "Read it and edit before approving." });
      if (!data.jobId) refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate AI response");
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    if (!reply) return;
    if (blockWhileSaving()) return;
    setError(null);
    setLoading("delete");
    try {
      await apiCall(`/api/reviews/${review.id}/reply`, "DELETE", {
        replyId: reply.id,
      });
      setDraftContent("");
      toast.success("Draft deleted");
      refresh();
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
            {review.group_name ? ` · ${review.group_name}` : ""}
          </p>
          <p className="text-xs text-slate">{workflow.label}</p>
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
          <StarRating rating={review.star_rating} size="md" />
          <span className="text-[11px] text-slate">
            {formatDate(review.review_create_time)}
          </span>
        </div>

        {/* Review text */}
        {reviewText ? (
          <div className="space-y-2">
            <p className="text-base font-light leading-relaxed text-graphite">{reviewText.original}</p>
            {reviewText.translation ? (
              <p className="text-sm leading-relaxed text-slate">
                <span className="font-medium text-graphite">Translation. </span>
                {reviewText.translation}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm italic text-slate">
            Rating only — no written comment.
          </p>
        )}
        <p className="text-xs text-slate">
          {[languageLabel(review.review_language), themeLabel(review.complaint_theme)]
            .filter(Boolean)
            .join(" · ") || "No language or complaint theme on this review."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <SelectField
            label="Assigned to"
            value={assignee}
            options={[
              { value: "", label: "Unassigned" },
              ...members.map((member) => ({ value: member.id, label: member.email })),
            ]}
            onValueChange={setAssignee}
            className="sm:w-64"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading !== null || assignee === (review.assigned_to ?? "")}
            onClick={async () => {
              setError(null);
              setLoading("assign");
              try {
                await apiCall(`/api/reviews/${review.id}/workflow`, "POST", {
                  action: "assign",
                  userId: assignee || null,
                });
                toast.success(assignee ? "Review assigned" : "Assignment cleared");
                refresh();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not assign the review.");
              } finally {
                setLoading(null);
              }
            }}
          >
            {loading === "assign" ? "Saving…" : "Save assignment"}
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate">Internal notes</p>
          {(review.notes ?? []).length === 0 ? (
            <p className="text-sm text-slate">No notes yet. Notes stay in GRM and are not posted to Google.</p>
          ) : (
            <ul className="space-y-2">
              {(review.notes ?? []).map((item) => (
                <li key={item.id} className="rounded-lg border border-silver px-3 py-2">
                  <p className="text-sm text-graphite">{item.body}</p>
                  <p className="mt-1 text-xs text-slate">
                    {members.find((member) => member.id === item.authorId)?.email ?? "Teammate"}
                    {" · "}
                    {formatDate(item.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!note.trim()) return;
              setError(null);
              setLoading("note");
              try {
                await apiCall(`/api/reviews/${review.id}/workflow`, "POST", {
                  action: "note",
                  body: note.trim(),
                });
                setNote("");
                toast.success("Note saved");
                refresh();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not save the note.");
              } finally {
                setLoading(null);
              }
            }}
          >
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              placeholder="Add an internal note"
              aria-label="Internal note"
            />
            <Button type="submit" size="sm" variant="outline" disabled={loading !== null || !note.trim()}>
              {loading === "note" ? "Saving…" : "Add note"}
            </Button>
          </form>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate">Activity</p>
          <ul className="space-y-1 text-sm text-slate">
            {[
              { at: review.review_create_time, label: "Review received" },
              review.review_update_time && review.review_update_time !== review.review_create_time
                ? { at: review.review_update_time, label: "Review edited on Google" }
                : null,
              review.reopened_at ? { at: review.reopened_at, label: "Reopened after a published reply" } : null,
              reply ? { at: reply.created_at, label: "Draft saved" } : null,
              reply?.approved_at ? { at: reply.approved_at, label: "Draft approved" } : null,
              reply?.published_at ? { at: reply.published_at, label: "Reply published" } : null,
              ...(review.activity ?? []),
              ...(review.notes ?? []).map((item) => ({ at: item.createdAt, label: "Internal note added" })),
            ]
              .filter((item): item is { at: string; label: string } => Boolean(item))
              .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
              .map((item) => (
                <li key={`${item.label}-${item.at}`}>
                  {formatDate(item.at)} · {item.label}
                </li>
              ))}
          </ul>
        </div>

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
            title={ACTION_STATUS.aiDraft.title}
            detail={ACTION_STATUS.aiDraft.detail}
          />
        ) : refreshing ? (
          <ActivityStatus
            title={ACTION_STATUS.applying.title}
            detail={
              reply?.source === "ai"
                ? "Your draft is already on screen. The review list is catching up."
                : ACTION_STATUS.applying.detail
            }
          />
        ) : null}
        {saveJob?.status === "saving" ? (
          <ActivityStatus
            title="Saving your draft…"
            detail="The draft above is ready to read. Approve and publish unlock as soon as it is saved."
          />
        ) : saveJob?.status === "failed" ? (
          <div className="space-y-2">
            <ActivityStatus
              title="This draft could not be saved yet"
              detail="The text above is safe. Retry the save — no new AI generation is needed."
            />
            <Button type="button" size="sm" variant="outline" onClick={() => void handleRetrySave()}>
              Retry save
            </Button>
          </div>
        ) : null}
        {loading === "publish" ? (
          <ActivityStatus
            tone="google"
            title="Submitting your reply…"
            detail="Sending the approved reply to Google Business Profile. Keep this open until it finishes."
          />
        ) : null}
        {loading === "approve" ? (
          <ActivityStatus
            title="Approving this reply…"
            detail="It stays in GRM as ready to publish. It is not on Google yet."
          />
        ) : null}
        {loading === "create" || loading === "edit" ? (
          <ActivityStatus
            title="Saving your changes…"
            detail="The reply stays in GRM. Publishing to Google is a separate step."
          />
        ) : null}
        {loading === "delete" ? (
          <ActivityStatus
            title="Removing this draft…"
            detail="The reply leaves GRM. A reply already on Google is not deleted from there."
          />
        ) : null}

        {/* Error display */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
            <p className="font-medium">
              {/generat|gemini|ai reply/i.test(error)
                ? "Your AI reply couldn't be generated"
                : /publish|submit/i.test(error)
                  ? "The reply couldn't be submitted"
                  : "Action failed"}
            </p>
            <p className="mt-0.5 text-[13px]">{error}</p>
            {/generat|gemini|ai reply/i.test(error) ? (
              <p className="mt-1 text-[11px] text-red-600">Your existing draft has been preserved.</p>
            ) : null}
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
        {!reply && !isCreating && replyStatus === "none" && (
          <div className="space-y-3 pt-1">
            <ResolutionContactActions contact={contact} disabled={loading !== null} onAdd={addContact} />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => handleGenerateAI()}
                loading={loading === "generate"}
                className="gap-1.5"
              >
                {loading !== "generate" ? <Sparkles className="h-3.5 w-3.5" aria-hidden /> : null}
                {loading === "generate" ? "Generating reply…" : "Generate AI Response"}
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
            <ResolutionContactActions contact={contact} disabled={loading !== null} onAdd={addContact} />
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
                <ResolutionContactActions contact={contact} disabled={loading !== null} onAdd={addContact} />
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
                    Generated reply. This is not a translation of the review.
                  </p>
                )}
                {review.star_rating <= 3 && reply.status !== "published" ? (
                  <p className="mb-1.5 text-[11px] text-slate">
                    This 1–3 star review stays unpublished until an owner or admin approves it.
                  </p>
                ) : null}
                {reply.approved_at && reply.status !== "draft" ? (
                  <p className="mb-1.5 text-[11px] text-slate">
                    Approved {formatDate(reply.approved_at)}
                    {reply.approved_by
                      ? ` by ${members.find((member) => member.id === reply.approved_by)?.email ?? "an owner or admin"}`
                      : ""}
                  </p>
                ) : null}
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
                <div className="mt-3">
                  <ResolutionContactActions contact={contact} disabled={loading !== null} onAdd={addContact} />
                </div>
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
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={loading !== null}
                          onClick={async () => {
                            setError(null);
                            setLoading("submit");
                            try {
                              await apiCall(`/api/reviews/${review.id}/reply/submit`, "POST", { replyId: reply.id });
                              toast.success("Submitted for approval");
                              refresh();
                            } catch (caught) {
                              setError(caught instanceof Error ? caught.message : "Could not submit the draft.");
                            } finally {
                              setLoading(null);
                            }
                          }}
                        >
                          {loading === "submit" ? "Submitting…" : "Submit for approval"}
                        </Button>
                        <p className="w-full text-xs text-slate">
                          An owner or admin needs to approve this draft before it can be published.
                        </p>
                      </>
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
                      onClick={() => handleGenerateAI()}
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
                    {(["shorter", "warmer", "formal"] as const).map((kind) => (
                      <Button
                        key={kind}
                        size="sm"
                        variant="outline"
                        disabled={loading !== null || isEditing}
                        onClick={() => handleGenerateAI({ adjustment: kind, replaceEdited: true })}
                      >
                        {kind === "shorter" ? "Shorter" : kind === "warmer" ? "Warmer" : "More formal"}
                      </Button>
                    ))}
                    <SelectField
                      label="Reply language"
                      value={replyLanguage}
                      options={[{ value: "", label: "Change language" }, ...REPLY_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))]}
                      onValueChange={setReplyLanguage}
                      disabled={loading !== null || isEditing}
                      className="w-40"
                      size="sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loading !== null || isEditing || !replyLanguage}
                      onClick={() => handleGenerateAI({ language: replyLanguage, replaceEdited: true })}
                    >
                      Rewrite
                    </Button>
                    <SelectField
                      label="Template"
                      value={templateId}
                      options={[{ value: "", label: "Apply template" }, ...REPLY_TEMPLATES.map((item) => ({ value: item.id, label: item.label }))]}
                      onValueChange={setTemplateId}
                      disabled={loading !== null || isEditing}
                      className="w-48"
                      size="sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loading !== null || isEditing || !templateId}
                      onClick={async () => {
                        if (blockRewrite()) return;
                        setError(null);
                        setLoading("template");
                        try {
                          await apiCall(`/api/reviews/${review.id}/reply/template`, "POST", {
                            templateId,
                            replyId: reply.id,
                            replaceEdited: true,
                          });
                          toast.success("Template applied");
                          refresh();
                        } catch (caught) {
                          setError(caught instanceof Error ? caught.message : "Could not apply the template.");
                        } finally {
                          setLoading(null);
                        }
                      }}
                    >
                      Apply
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
                    {canApprove ? (
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
                    ) : (
                      <p className="w-full text-xs text-slate">An owner or admin publishes this reply.</p>
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
                {reply.status === "pending_publish" && canApprove ? (
                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={handlePublish} disabled={loading !== null}>
                      {loading === "publish" ? "Checking Google…" : "Check whether Google has this reply"}
                    </Button>
                  </div>
                ) : null}
                {reply.status === "failed" && canApprove ? (
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
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResolutionContactActions({
  contact,
  disabled,
  onAdd,
}: {
  contact: ResolutionContact;
  disabled: boolean;
  onAdd: (kind: ResolutionContactKind) => void;
}) {
  if (!contact.phone && !contact.email) {
    return (
      <p className="text-xs text-slate">
        <a href="/settings?section=sla" className="text-ink underline">
          Set a resolution phone or email in Settings
        </a>{" "}
        before adding it to this reply.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled || !contact.phone} onClick={() => onAdd("phone")}>
          Add phone
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || !contact.email} onClick={() => onAdd("email")}>
          Add email
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !contact.phone || !contact.email}
          onClick={() => onAdd("both")}
        >
          Add both
        </Button>
      </div>
      <p className="text-xs text-slate">Adds a contact line to the draft. Save it before publishing. Nothing is posted on its own.</p>
    </div>
  );
}
