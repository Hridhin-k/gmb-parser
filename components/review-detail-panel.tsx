"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Textarea } from "@/components/ui/textarea";
import {
  X,
  Send,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Sparkles,
  Trash2,
  RotateCw,
  MessageSquare,
} from "lucide-react";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { ActivityStatus } from "@/components/activity-status";
import { Spinner } from "@/components/ui/spinner";
import { SelectField } from "@/components/ui/select-field";
import { Input } from "@/components/ui/input";
import { languageLabel, themeLabel } from "@/lib/review-inbox";
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
import { InlineStars, ReviewStateBadges, reviewStateBadges } from "@/components/reviews-badges";

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
  aiOnly?: boolean;
  contact?: ResolutionContact;
  members?: Array<{ id: string; email: string }>;
  onClose: () => void;
  /** Open the previous / next review in the list. Omitted at the ends. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Reports unsaved reply edits so the list can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Paint the new draft on the inbox row without waiting for a page refresh. */
  onDraft?: (reviewId: string, reply: ReplyForPanel) => void;
  /** Changes only when the server inbox payload changes, not when a draft is painted locally. */
  inboxRevision?: number;
}

/** Server validation limit for reply content. */
const REPLY_MAX = 4000;

function formatDate(iso: string | null): string {
  return formatFriendlyDateTime(iso, "2-digit");
}

type ErrorSource = "generate" | "publish" | "other";

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ReviewDetailPanel({
  review,
  reply: serverReply,
  canApprove,
  aiOnly = false,
  contact = { phone: null, email: null },
  members = [],
  onClose,
  onPrev,
  onNext,
  onDirtyChange,
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
  // The list remounts this panel per review (key), so initial state is per review.
  const [draftContent, setDraftContent] = useState(serverReply?.content ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editedHere, setEditedHere] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; from: ErrorSource } | null>(null);
  const setError = (message: string | null, from: ErrorSource = "other") =>
    setFailure(message ? { message, from } : null);
  const [assignee, setAssignee] = useState(review.assigned_to ?? "");
  const [note, setNote] = useState("");
  const [replyLanguage, setReplyLanguage] = useState("");
  const [templateId, setTemplateId] = useState("");
  const reviewText = review.comment ? splitGoogleTranslation(review.comment) : null;

  // Drop the optimistic copy once the server payload reflects it.
  const [seenServer, setSeenServer] = useState({ reply: serverReply, status: review.reply_status });
  if (seenServer.reply !== serverReply || seenServer.status !== review.reply_status) {
    setSeenServer({ reply: serverReply, status: review.reply_status });
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
  }

  const dirty =
    (isEditing && reply !== null && draftContent !== reply.content) ||
    (isCreating && draftContent.trim() !== "");

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function addContact(kind: ResolutionContactKind) {
    const sentence = resolutionContactSentence(kind, contact);
    if (!sentence) return;
    const base = isEditing || isCreating ? draftContent : (reply?.content ?? "");
    setDraftContent(insertResolutionContact(base, sentence));
    if (reply) setIsEditing(true);
    else setIsCreating(true);
    setError(null);
  }

  const reviewerName = review.reviewer_is_anonymous
    ? "Anonymous"
    : (review.reviewer_display_name || "Unknown reviewer");

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
      setEditedHere(true);
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
      setEditedHere(true);
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
      setError(e instanceof Error ? e.message : "Failed to publish reply", "publish");
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
      setError(e instanceof Error ? e.message : "Failed to approve and publish reply", "publish");
    } finally {
      setLoading(null);
    }
  }

  async function handleSubmitForApproval() {
    if (!reply) return;
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
  }

  async function handleApplyTemplate() {
    if (!reply) return;
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
  }

  async function handleAssign() {
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
  }

  async function handleAddNote(event: React.FormEvent<HTMLFormElement>) {
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
        setEditedHere(false);
        onDraft?.(review.id, next);
        if (data.jobId) {
          setSaveJob({ jobId: data.jobId, status: "saving", content: data.content });
          watchSave(data.jobId, data.content);
        }
      }
      toast.success("AI draft ready", { description: "Read it and edit before approving." });
      if (!data.jobId) refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate AI response", "generate");
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

  function startEdit() {
    if (!reply) return;
    setDraftContent(reply.content);
    setIsEditing(true);
    setError(null);
  }

  // ── Derived view state ───────────────────────────────────────────────────

  const generating = loading === "generate";
  const publishing = loading === "publish";
  const busy = loading !== null;
  const canPublish = canApprove || aiOnly;
  const generationFailure = failure?.from === "generate" ? failure.message : null;
  const budgetReached = generationFailure !== null && /monthly ai budget|ai draft limit/i.test(generationFailure);
  const rateLimited = generationFailure !== null && !budgetReached && /too many/i.test(generationFailure);
  const assigneeEmail = review.assigned_to
    ? (members.find((member) => member.id === review.assigned_to)?.email ?? "a teammate")
    : null;
  const badges = reviewStateBadges({
    replyStatus,
    starRating: review.star_rating,
    reopenedAt: review.reopened_at ?? null,
    hasGoogleReply: Boolean(review.google_reply_comment),
    source: reply?.source,
    publishing,
  });
  const theme = themeLabel(review.complaint_theme);
  const language = languageLabel(review.review_language);
  const aiDraft = reply?.source === "ai" && !editedHere;

  const activity = [
    { at: review.review_create_time, label: "Review received", tone: "default" },
    review.review_update_time && review.review_update_time !== review.review_create_time
      ? { at: review.review_update_time, label: "Review edited on Google", tone: "default" }
      : null,
    review.reopened_at ? { at: review.reopened_at, label: "Reopened after a published reply", tone: "warn" } : null,
    reply ? { at: reply.created_at, label: "Draft saved", tone: reply.source === "ai" ? "ai" : "brand" } : null,
    reply?.approved_at ? { at: reply.approved_at, label: "Draft approved", tone: "brand" } : null,
    reply?.published_at ? { at: reply.published_at, label: "Reply published", tone: "ok" } : null,
    ...(review.activity ?? []).map((item) => ({ ...item, tone: "default" })),
    ...(review.notes ?? []).map((item) => ({ at: item.createdAt, label: "Internal note added", tone: "brand" })),
  ]
    .filter((item): item is { at: string; label: string; tone: string } => Boolean(item))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // ── Render ───────────────────────────────────────────────────────────────

  const charCount = (
    <span className={cn("tabular-nums", draftContent.length > REPLY_MAX && "font-medium text-bad")}>
      {draftContent.length.toLocaleString("en-US")} / {REPLY_MAX.toLocaleString("en-US")} characters
    </span>
  );

  function renderReply() {
    if (generating) {
      return (
        <div className="flex min-h-[150px] flex-col gap-2.5 rounded-lg border border-ai-line bg-[#fbf9ff] p-3" aria-busy="true">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Spinner size="sm" className="text-ai" />
            <Badge variant="ai">
              <Sparkles aria-hidden />
              Generating draft
            </Badge>
            <span>{reply ? "Replacing the current draft" : "Using your saved reply guidelines"}</span>
          </div>
          <span className="h-3 w-[90%] animate-pulse rounded bg-[#e9e0fb]" />
          <span className="h-3 w-[95%] animate-pulse rounded bg-[#e9e0fb]" />
          <span className="h-3 w-[70%] animate-pulse rounded bg-[#e9e0fb]" />
          <p className="mt-auto text-xs text-ink-3">{ACTION_STATUS.aiDraft.detail}</p>
        </div>
      );
    }

    if (isCreating && !reply && !aiOnly) {
      return (
        <div className="space-y-2.5 rounded-lg border border-line bg-white p-3">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Badge variant="brand">
              <Pencil aria-hidden />
              Written by you
            </Badge>
            <span>Not visible to the customer until published</span>
          </div>
          <ResolutionContactActions contact={contact} disabled={busy} onAdd={addContact} />
          <label htmlFor="draft-reply" className="sr-only">
            Draft reply
          </label>
          <Textarea
            id="draft-reply"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            placeholder="Write your reply…"
            rows={5}
            autoFocus
          />
          <p className="text-xs text-ink-3">{charCount}</p>
        </div>
      );
    }

    if (reply && isEditing && !aiOnly) {
      return (
        <div className="space-y-2.5 rounded-lg border border-line bg-white p-3">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Badge variant="brand">
              <Pencil aria-hidden />
              Editing
            </Badge>
            <span>{dirty ? "Unsaved changes" : "No changes yet"}</span>
          </div>
          <ResolutionContactActions contact={contact} disabled={busy} onAdd={addContact} />
          <label htmlFor="edit-reply" className="sr-only">
            Edit reply
          </label>
          <Textarea
            id="edit-reply"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={6}
            autoFocus
          />
          <p className="text-xs text-ink-3">{charCount}</p>
        </div>
      );
    }

    if (reply) {
      const published = reply.status === "published";
      const pendingPublish = reply.status === "pending_publish";
      const failed = reply.status === "failed";
      return (
        <div
          className={cn(
            "overflow-hidden rounded-lg border",
            published
              ? "border-ok-line bg-[#f8fcf9]"
              : failed
                ? "border-bad-line bg-white"
                : pendingPublish
                  ? "border-dashed border-warn-line bg-white"
                  : aiDraft && reply.status === "draft"
                    ? "border-ai-line bg-[#fbf9ff]"
                    : "border-line bg-white"
          )}
        >
          <div className="flex flex-wrap items-center gap-2 px-3 pt-3 text-xs text-ink-3">
            {publishing ? (
              <>
                <Spinner size="sm" className="text-info" />
                <Badge variant="info">Publishing…</Badge>
                <span>Sending to Google</span>
              </>
            ) : published ? (
              <>
                <Badge variant="ok">
                  <CheckCircle2 aria-hidden />
                  Published to Google
                </Badge>
                {reply.published_at ? <span>{formatDate(reply.published_at)}</span> : null}
              </>
            ) : pendingPublish ? (
              <Badge variant="warn">Awaiting confirmation</Badge>
            ) : failed ? (
              <>
                <Badge variant="bad">Not published</Badge>
                {reply.failure_count > 0 ? (
                  <span>
                    {reply.failure_count} failed attempt{reply.failure_count === 1 ? "" : "s"}
                  </span>
                ) : null}
              </>
            ) : reply.status === "approved" ? (
              <Badge variant="brand">
                <CheckCircle2 aria-hidden />
                Approved · ready to publish
              </Badge>
            ) : aiDraft ? (
              <>
                <Badge variant="ai">
                  <Sparkles aria-hidden />
                  AI draft
                </Badge>
                <span>Not visible to the customer · {formatDate(reply.created_at)}</span>
              </>
            ) : (
              <>
                <Badge variant="brand">
                  <Pencil aria-hidden />
                  {editedHere ? "Edited by you" : "Written by your team"}
                </Badge>
                <span>Not visible to the customer</span>
              </>
            )}
          </div>

          <div className="space-y-1.5 px-3 pt-2 pb-3">
            {aiDraft && !published ? (
              <p className="text-xs text-ai">Generated reply. This is not a translation of the review.</p>
            ) : null}
            {review.star_rating <= 3 && reply.status === "draft" ? (
              <p className="text-xs text-ink-3">
                {aiOnly
                  ? "A higher role has to approve this draft before you can publish it."
                  : "This 1–3 star review stays unpublished until an owner or admin approves it."}
              </p>
            ) : null}
            {reply.approved_at && reply.status !== "draft" ? (
              <p className="text-xs text-ink-3">
                Approved {formatDate(reply.approved_at)}
                {reply.approved_by
                  ? ` by ${members.find((member) => member.id === reply.approved_by)?.email ?? "an owner or admin"}`
                  : ""}
              </p>
            ) : null}
            <p
              className={cn(
                "whitespace-pre-wrap text-[13px] leading-relaxed text-ink",
                publishing && "opacity-60"
              )}
            >
              {reply.content}
            </p>
          </div>

          {reply.status === "draft" ? (
            <div
              className={cn(
                "flex flex-wrap items-center gap-1.5 border-t px-3 py-2",
                aiDraft ? "border-ai-line" : "border-line"
              )}
              aria-label="Rewrite with AI"
              role="group"
            >
              <Button size="xs" variant="ai" onClick={() => handleGenerateAI()} disabled={busy}>
                <RotateCw aria-hidden />
                Regenerate
              </Button>
              {(["shorter", "warmer", "formal"] as const).map((kind) => (
                <Button
                  key={kind}
                  size="xs"
                  variant="ai"
                  disabled={busy || isEditing}
                  onClick={() => handleGenerateAI({ adjustment: kind, replaceEdited: true })}
                >
                  {kind === "shorter" ? "Shorter" : kind === "warmer" ? "Warmer" : "More formal"}
                </Button>
              ))}
              <span className="flex items-center gap-1">
                <SelectField
                  label="Reply language"
                  value={replyLanguage}
                  options={[
                    { value: "", label: "Language…" },
                    ...REPLY_LANGUAGES.map((item) => ({ value: item.id, label: item.label })),
                  ]}
                  onValueChange={setReplyLanguage}
                  disabled={busy || isEditing}
                  className="w-32"
                  size="sm"
                />
                <Button
                  size="xs"
                  variant="ai"
                  disabled={busy || isEditing || !replyLanguage}
                  onClick={() => handleGenerateAI({ language: replyLanguage, replaceEdited: true })}
                >
                  Rewrite
                </Button>
              </span>
              {aiOnly ? null : (
                <span className="flex items-center gap-1">
                  <SelectField
                    label="Template"
                    value={templateId}
                    options={[
                      { value: "", label: "Template…" },
                      ...REPLY_TEMPLATES.map((item) => ({ value: item.id, label: item.label })),
                    ]}
                    onValueChange={setTemplateId}
                    disabled={busy || isEditing}
                    className="w-36"
                    size="sm"
                  />
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || isEditing || !templateId}
                    loading={loading === "template"}
                    onClick={() => void handleApplyTemplate()}
                  >
                    Apply
                  </Button>
                </span>
              )}
            </div>
          ) : null}

          {aiOnly ? null : (
            <div className={cn("border-t px-3 py-2", published ? "border-ok-line" : "border-line-2")}>
              <ResolutionContactActions contact={contact} disabled={busy} onAdd={addContact} />
            </div>
          )}
        </div>
      );
    }

    if (replyStatus === "none") {
      return (
        <div className="space-y-3 rounded-lg border border-dashed border-line p-4">
          <p className="text-[13px] text-ink-3">
            {aiOnly
              ? "No reply yet. Your reply is written by AI. A higher role approves it, and then you can publish it."
              : "No reply yet. Generate a draft with your saved reply guidelines, or write one yourself."}
          </p>
          {aiOnly ? null : <ResolutionContactActions contact={contact} disabled={busy} onAdd={addContact} />}
        </div>
      );
    }
    return null;
  }

  function renderFooter() {
    if (isCreating && !reply && !aiOnly) {
      return (
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setIsCreating(false);
              setDraftContent("");
            }}
          >
            Cancel
          </Button>
          <span className="flex-1" />
          <Button onClick={handleCreateDraft} disabled={loading === "create" || !draftContent.trim()} loading={loading === "create"}>
            <Send aria-hidden />
            {loading === "create" ? "Saving…" : "Save draft"}
          </Button>
        </>
      );
    }
    if (reply && isEditing && !aiOnly) {
      return (
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setIsEditing(false);
              setDraftContent(reply.content);
            }}
          >
            Cancel
          </Button>
          <span className="flex-1" />
          <Button onClick={handleSaveEdit} disabled={loading === "edit" || !draftContent.trim()} loading={loading === "edit"}>
            <CheckCircle2 aria-hidden />
            {loading === "edit" ? "Saving…" : "Save changes"}
          </Button>
        </>
      );
    }
    if (generating) {
      return (
        <>
          <span className="text-xs text-ink-3">Drafting… you can keep reading the review.</span>
          <span className="flex-1" />
          <Button disabled title="Wait for the draft first">
            Approve
          </Button>
        </>
      );
    }
    if (!reply) {
      if (replyStatus !== "none") return null;
      return (
        <>
          <span className="flex-1" />
          {aiOnly ? null : (
            <Button variant="outline" onClick={() => setIsCreating(true)} disabled={busy}>
              <Pencil aria-hidden />
              Write reply
            </Button>
          )}
          <Button variant="ai" onClick={() => handleGenerateAI()} disabled={busy}>
            <Sparkles aria-hidden />
            Generate draft
          </Button>
        </>
      );
    }

    const rejectButton = (
      <Button variant="destructive" size="sm" onClick={handleDelete} disabled={busy} loading={loading === "delete"} aria-label="Reject draft">
        <Trash2 aria-hidden />
        Reject
      </Button>
    );
    const editButton = aiOnly ? null : (
      <Button variant="outline" size="sm" onClick={startEdit} disabled={busy}>
        <Pencil aria-hidden />
        Edit
      </Button>
    );

    if (reply.status === "draft") {
      return (
        <>
          {rejectButton}
          {editButton}
          <span className="flex-1" />
          {canApprove ? (
            <>
              <Button variant="outline" onClick={handleApprove} disabled={busy} loading={loading === "approve"}>
                <CheckCircle2 aria-hidden />
                {loading === "approve" ? "Approving…" : "Approve only"}
              </Button>
              <Button onClick={handleApproveAndPublish} disabled={busy} loading={publishing}>
                <Send aria-hidden />
                {publishing ? "Posting to Google…" : "Approve & publish"}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => void handleSubmitForApproval()}
              disabled={busy}
              loading={loading === "submit"}
              title={
                aiOnly
                  ? "A higher role approves this draft. After that, you can publish it."
                  : "An owner or admin approves this draft before it can be published."
              }
            >
              {loading === "submit" ? "Submitting…" : "Submit for approval"}
            </Button>
          )}
        </>
      );
    }
    if (reply.status === "approved") {
      return (
        <>
          {aiOnly ? null : rejectButton}
          {editButton}
          <span className="flex-1" />
          {canPublish ? (
            <Button onClick={handlePublish} disabled={busy} loading={publishing}>
              <Send aria-hidden />
              {publishing ? "Posting to Google…" : "Publish to Google"}
            </Button>
          ) : (
            <span className="text-xs text-ink-3">An owner or admin publishes this reply.</span>
          )}
        </>
      );
    }
    if (reply.status === "failed" && canPublish) {
      return (
        <>
          {aiOnly ? (
            <Button
              variant="ai"
              size="sm"
              onClick={() => handleGenerateAI({ adjustment: "regenerate", replaceEdited: true })}
              disabled={busy}
              title="Generating a new reply sends it back for approval."
            >
              <RotateCw aria-hidden />
              Regenerate
            </Button>
          ) : (
            editButton
          )}
          <span className="flex-1" />
          <Button onClick={handlePublish} disabled={busy} loading={publishing}>
            <Send aria-hidden />
            {publishing ? "Posting to Google…" : "Retry publish"}
          </Button>
        </>
      );
    }
    if (reply.status === "pending_publish" && canPublish) {
      return (
        <>
          <span className="flex-1" />
          <Button variant="outline" onClick={handlePublish} disabled={busy} loading={publishing}>
            {publishing ? "Checking Google…" : "Check whether Google has this reply"}
          </Button>
        </>
      );
    }
    if (reply.status === "published" && onNext) {
      return (
        <>
          <span className="flex-1" />
          <Button variant="outline" onClick={onNext}>
            Next review
            <ChevronRight aria-hidden />
          </Button>
        </>
      );
    }
    return null;
  }

  const footer = renderFooter();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-3">
            <InlineStars rating={review.star_rating} />
            <b className="text-[13px] font-semibold text-ink">{reviewerName}</b>
            <span aria-hidden>·</span>
            <span>{review.location_title}</span>
            {review.client_name ? (
              <>
                <span aria-hidden>·</span>
                <span>{review.client_name}</span>
              </>
            ) : null}
            {review.group_name ? (
              <>
                <span aria-hidden>·</span>
                <span>{review.group_name}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>{formatDate(review.review_create_time)}</span>
            {language ? (
              <>
                <span aria-hidden>·</span>
                <span>{language}</span>
              </>
            ) : null}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <ReviewStateBadges badges={badges} />
            {theme ? <Badge variant="outline">{theme}</Badge> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onPrev} disabled={!onPrev} aria-label="Previous review">
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onNext} disabled={!onNext} aria-label="Next review">
            <ChevronRight className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close review detail">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Original review */}
        {reviewText ? (
          <div className="space-y-2 border-l-2 border-star py-1 pl-3">
            <p className="text-sm leading-relaxed text-ink-2">{reviewText.original}</p>
            {reviewText.translation ? (
              <p className="text-[13px] leading-relaxed text-ink-3">
                <span className="font-medium text-ink-2">Translation. </span>
                {reviewText.translation}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="border-l-2 border-line py-1 pl-3 text-[13px] italic text-ink-3">Rating only. No written comment.</p>
        )}

        {/* Assignment + details */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-2">Assignee</p>
            {aiOnly ? (
              <p className="text-[13px] text-ink-2">{assigneeEmail ? `Assigned to ${assigneeEmail}` : "Unassigned"}</p>
            ) : (
              <div className="flex items-center gap-1.5">
                <SelectField
                  label="Assigned to"
                  value={assignee}
                  options={[
                    { value: "", label: "Unassigned" },
                    ...members.map((member) => ({ value: member.id, label: member.email })),
                  ]}
                  onValueChange={setAssignee}
                  className="min-w-0 flex-1"
                  size="sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || assignee === (review.assigned_to ?? "")}
                  loading={loading === "assign"}
                  onClick={() => void handleAssign()}
                >
                  {loading === "assign" ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-2">Details</p>
            <p className="text-[13px] text-ink-2">
              {[language, theme].filter(Boolean).join(" · ") || "No language or complaint theme on this review."}
            </p>
          </div>
        </div>

        {/* Existing Google reply (when RevuPilot's copy is not the live one) */}
        {review.google_reply_comment && reply?.status !== "published" ? (
          <div className="rounded-lg border border-ok-line bg-[#f8fcf9] p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <Badge variant="ok">
                <MessageSquare aria-hidden />
                Live on Google
              </Badge>
              {review.google_reply_update_time ? <span>{formatDate(review.google_reply_update_time)}</span> : null}
            </div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{review.google_reply_comment}</p>
          </div>
        ) : null}

        {/* Reply */}
        <section className="space-y-2" aria-label="Reply">
          <h3 className="text-xs font-medium text-ink-2">Reply</h3>

          {generationFailure ? (
            budgetReached ? (
              <Banner
                tone="ai"
                title="AI drafting is paused for this workspace."
                actions={
                  !reply && !aiOnly ? (
                    <Button size="sm" variant="outline" onClick={() => setIsCreating(true)}>
                      Write reply instead
                    </Button>
                  ) : null
                }
              >
                {generationFailure} An owner can raise the budget; until then, write the reply yourself or use a template.
              </Banner>
            ) : rateLimited ? (
              <Banner
                tone="warn"
                title="Too many drafts at once."
                actions={
                  <Button size="sm" variant="ai" onClick={() => handleGenerateAI()} disabled={busy}>
                    <Sparkles aria-hidden />
                    Try again
                  </Button>
                }
              >
                {generationFailure}
              </Banner>
            ) : (
              <Banner
                tone="bad"
                title="Couldn't generate a draft."
                actions={
                  <>
                    <Button size="sm" variant="ai" onClick={() => handleGenerateAI()} disabled={busy}>
                      <Sparkles aria-hidden />
                      Try again
                    </Button>
                    {!reply && !aiOnly ? (
                      <Button size="sm" variant="outline" onClick={() => setIsCreating(true)}>
                        Write reply instead
                      </Button>
                    ) : null}
                  </>
                }
              >
                {generationFailure}
                {reply ? " Your existing draft has been kept." : ""}
              </Banner>
            )
          ) : null}

          {reply?.status === "pending_publish" && !publishing ? (
            <Banner tone="warn" title="We can't confirm this reply is live.">
              Google may have accepted it, but the result was not confirmed. Check Google before publishing again;
              republishing can create a duplicate reply.
            </Banner>
          ) : null}

          {reply?.status === "failed" && !publishing ? (
            <Banner tone="bad" title="Google did not publish this reply.">
              {reply.last_error ? `Reason: ${reply.last_error} ` : ""}
              {aiOnly
                ? "You can try publishing again. Generating a new reply sends it back for approval."
                : "You can edit the reply and try publishing again."}
            </Banner>
          ) : null}

          {failure && failure.from === "publish" ? (
            <Banner tone="bad" title="The reply couldn't be submitted.">
              {failure.message}
            </Banner>
          ) : null}

          {renderReply()}

          {saveJob?.status === "saving" ? (
            <ActivityStatus
              title="Saving your draft…"
              detail="The draft above is ready to read. Approve and publish unlock as soon as it is saved."
            />
          ) : saveJob?.status === "failed" ? (
            <Banner
              tone="warn"
              title="This draft could not be saved yet."
              actions={
                <Button type="button" size="sm" variant="outline" onClick={() => void handleRetrySave()}>
                  Retry save
                </Button>
              }
            >
              The text above is safe. Retry the save. No new AI generation is needed.
            </Banner>
          ) : null}

          {publishing ? (
            <ActivityStatus tone="google" title={ACTION_STATUS.publish.title} detail={ACTION_STATUS.publish.detail} />
          ) : null}
          {loading === "approve" ? (
            <ActivityStatus title={ACTION_STATUS.approve.title} detail={ACTION_STATUS.approve.detail} />
          ) : null}
          {loading === "create" || loading === "edit" ? (
            <ActivityStatus
              title="Saving your changes…"
              detail="The reply is saved here. Publishing to Google is a separate step."
            />
          ) : null}
          {loading === "delete" ? (
            <ActivityStatus
              title="Removing this draft…"
              detail="The draft is deleted here. A reply already on Google is not deleted from there."
            />
          ) : null}
          {refreshing && !busy ? (
            <ActivityStatus
              title={ACTION_STATUS.applying.title}
              detail={
                reply?.source === "ai"
                  ? "Your draft is already on screen. The review list is catching up."
                  : ACTION_STATUS.applying.detail
              }
            />
          ) : null}

          {failure && failure.from === "other" ? (
            <Banner tone="bad" title="Action failed.">
              {failure.message}
            </Banner>
          ) : null}
        </section>

        {/* Internal notes */}
        <section className="space-y-2" aria-label="Internal notes">
          <h3 className="text-xs font-medium text-ink-2">
            Internal notes{(review.notes ?? []).length > 0 ? ` · ${(review.notes ?? []).length}` : ""}
          </h3>
          {(review.notes ?? []).length === 0 ? (
            <p className="text-xs text-ink-3">No notes yet. Notes stay with your team and are never posted to Google.</p>
          ) : (
            <ul className="space-y-2">
              {(review.notes ?? []).map((item) => (
                <li key={item.id} className="rounded-lg border border-line px-3 py-2 text-xs">
                  <p className="mb-1 flex justify-between gap-2">
                    <b className="truncate font-semibold text-ink">
                      {members.find((member) => member.id === item.authorId)?.email ?? "Teammate"}
                    </b>
                    <span className="shrink-0 text-ink-3">{formatDate(item.createdAt)}</span>
                  </p>
                  <p className="text-[13px] text-ink-2">{item.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form className="flex gap-2" onSubmit={handleAddNote}>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              placeholder="Add a note for your team (never published)"
              aria-label="Internal note"
              className="h-8"
            />
            <Button type="submit" size="sm" variant="outline" disabled={busy || !note.trim()} loading={loading === "note"}>
              {loading === "note" ? "Saving…" : "Add note"}
            </Button>
          </form>
        </section>

        {/* Activity */}
        <section className="space-y-2" aria-label="Activity">
          <h3 className="text-xs font-medium text-ink-2">Activity</h3>
          <ol className="text-xs">
            {activity.map((item, index) => (
              <li key={`${item.label}-${item.at}-${index}`} className="relative grid grid-cols-[20px_1fr] gap-2.5 pb-3.5 last:pb-0">
                {index < activity.length - 1 ? (
                  <span aria-hidden className="absolute top-3.5 bottom-0 left-[7px] w-0.5 bg-line-2" />
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    "relative z-[1] mt-[3px] ml-[3px] size-2.5 rounded-full border-2 bg-white",
                    item.tone === "ok"
                      ? "border-ok"
                      : item.tone === "ai"
                        ? "border-ai"
                        : item.tone === "brand"
                          ? "border-brand"
                          : item.tone === "warn"
                            ? "border-warn"
                            : "border-ink-3"
                  )}
                />
                <span className="text-ink-2">
                  {item.label} · <span className="text-ink-3">{formatDate(item.at)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {footer ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-3">{footer}</div>
      ) : null}
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
      <p className="text-xs text-ink-3">
        <a href="/settings?section=sla" className="font-medium text-brand hover:underline">
          Set a resolution phone or email in Settings
        </a>{" "}
        before adding it to this reply.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-3">Add contact:</span>
      <Button type="button" size="xs" variant="ghost" disabled={disabled || !contact.phone} onClick={() => onAdd("phone")}>
        Phone
      </Button>
      <Button type="button" size="xs" variant="ghost" disabled={disabled || !contact.email} onClick={() => onAdd("email")}>
        Email
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={disabled || !contact.phone || !contact.email}
        onClick={() => onAdd("both")}
      >
        Both
      </Button>
      <span
        className="text-xs text-ink-3"
        title="Adds a contact line to the draft. Save it before publishing. Nothing is posted on its own."
      >
        · adds a line to the draft
      </span>
    </div>
  );
}
