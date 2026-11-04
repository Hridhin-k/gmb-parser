"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Check, ChevronLeft, Phone, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { DraftContactMenu } from "@/components/draft-contact-menu";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { languageLabel, themeLabel } from "@/lib/review-inbox";
import { splitGoogleTranslation } from "@/lib/review-text";
import {
  insertResolutionContact,
  resolutionContactSentence,
  type ResolutionContact,
  type ResolutionContactKind,
  type ResolutionContactSelection,
} from "@/lib/resolution-contact";
import { isLowRating, longAge, type ReplyStage } from "@/components/reviews-status";

// ---------------------------------------------------------------------------
// Types shared with the inbox list
// ---------------------------------------------------------------------------

export interface InboxReview {
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

export interface InboxReply {
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

export type RewriteKind = "shorter" | "warmer" | "apology";

export interface FollowUpRef {
  id: string;
  dueAt: string;
}

interface ReviewDetailPanelProps {
  review: InboxReview;
  reply: InboxReply | null;
  stage: ReplyStage;
  /** Sent from this screen just now (as opposed to an older live reply). */
  justSent: boolean;
  /** AI draft text is on screen but still being saved. */
  saving: boolean;
  error: string | null;
  canSend: boolean;
  aiOnly: boolean;
  contact: ResolutionContact;
  members: Array<{ id: string; email: string }>;
  followUp: FollowUpRef | null;
  /** Reviews still without a draft, for the "draft them all" tip. */
  undraftedCount: number;
  onDraft: (rewrite?: RewriteKind, contactDetails?: ResolutionContactSelection) => void;
  onSend: () => void;
  onUndo: () => void;
  onFlag: () => Promise<void>;
  /** The reply was written or edited here and saved. */
  onSaved: (reply: InboxReply) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Phone sheet only: back to the list. */
  onClose?: () => void;
}

/** Server validation limit for reply content. */
const REPLY_MAX = 4000;

export function reviewerName(review: Pick<InboxReview, "reviewer_is_anonymous" | "reviewer_display_name">): string {
  return review.reviewer_is_anonymous ? "Anonymous" : review.reviewer_display_name || "Unknown reviewer";
}

/** The business a reply posts as. */
export function businessName(review: Pick<InboxReview, "client_name" | "location_title">): string {
  return review.client_name || review.location_title.split(" — ")[0] || review.location_title;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const STAGE_TAG: Record<ReplyStage | "justSent", { label: string; className: string }> = {
  none: { label: "No reply yet", className: "bg-line-2 text-ink-2" },
  writing: { label: "Writing reply", className: "bg-ai-tint text-ai" },
  draft: { label: "Draft ready", className: "bg-ai-tint text-ai" },
  sending: { label: "Sending", className: "bg-ai-tint text-ai" },
  held: { label: "Sent", className: "bg-ok-tint text-ok" },
  justSent: { label: "Sent", className: "bg-ok-tint text-ok" },
  sent: { label: "Replied", className: "bg-ok-tint text-ok" },
  unconfirmed: { label: "Checking Google", className: "bg-warn-tint text-warn" },
  failed: { label: "Not sent", className: "bg-bad-tint text-bad" },
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ReviewDetailPanel({
  review,
  reply,
  stage,
  justSent,
  saving,
  error,
  canSend,
  aiOnly,
  contact,
  members,
  followUp,
  undraftedCount,
  onDraft,
  onSend,
  onUndo,
  onFlag,
  onSaved,
  onDirtyChange,
  onClose,
}: ReviewDetailPanelProps) {
  const searchParams = useSearchParams();
  // The list remounts this panel per review (key), so initial state is per review.
  const [editing, setEditing] = useState(false);
  const [own, setOwn] = useState(false);
  const [content, setContent] = useState(reply?.content ?? "");
  const [editedHere, setEditedHere] = useState(false);
  const [loading, setLoading] = useState<null | "save" | "submit" | "flag" | "assign" | "note">(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(review.assigned_to ?? "");
  const [note, setNote] = useState("");

  // A new draft arrived (AI or a rewrite): show it unless the person is typing.
  const [seenReply, setSeenReply] = useState(reply);
  if (seenReply !== reply) {
    setSeenReply(reply);
    if (!editing) setContent(reply?.content ?? "");
  }

  const name = reviewerName(review);
  const business = businessName(review);
  const text = review.comment ? splitGoogleTranslation(review.comment) : null;
  const low = isLowRating(review.star_rating);
  const dirty = editing && content.trim() !== (own ? "" : (reply?.content ?? "")).trim();
  const busy = loading !== null || stage === "writing" || stage === "sending";
  const tag = STAGE_TAG[justSent && stage === "sent" ? "justSent" : stage];
  const isDraftStage = stage === "draft" || stage === "failed";
  const showDraft = isDraftStage || own;

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

  async function apiCall(url: string, method: string, body?: object) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
    return data;
  }

  /** Saves typed text. Returns false when nothing could be saved. */
  async function saveText(): Promise<boolean> {
    const next = content.trim();
    if (!next) {
      setLocalError("Write a reply first.");
      return false;
    }
    if (next.length > REPLY_MAX) {
      setLocalError(`Replies can be up to ${REPLY_MAX.toLocaleString("en-US")} characters.`);
      return false;
    }
    if (!dirty && reply && !own) return true;
    setLocalError(null);
    setLoading("save");
    try {
      if (reply && !own) {
        await apiCall(`/api/reviews/${review.id}/reply`, "PUT", { replyId: reply.id, content: next });
        onSaved({ ...reply, content: next, status: reply.status === "failed" ? "failed" : "draft" });
        setEditedHere(true);
      } else {
        const created = (await apiCall(`/api/reviews/${review.id}/reply`, "POST", { content: next })) as unknown as InboxReply;
        onSaved({
          id: created.id,
          content: next,
          source: created.source ?? "manual",
          status: "draft",
          created_at: created.created_at ?? new Date().toISOString(),
          approved_at: null,
          published_at: null,
          last_error: null,
          failure_count: 0,
        });
        setOwn(false);
      }
      setEditing(false);
      return true;
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "The reply could not be saved.");
      return false;
    } finally {
      setLoading(null);
    }
  }

  async function handleSend() {
    if (editing && !(await saveText())) return;
    onSend();
  }

  async function handleSubmitForApproval() {
    if (!reply) return;
    if (editing && !(await saveText())) return;
    setLocalError(null);
    setLoading("submit");
    try {
      await apiCall(`/api/reviews/${review.id}/reply/submit`, "POST", { replyId: reply.id });
      toast.success("Sent for approval", { description: "Someone who can approve will read it before it goes to Google." });
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not submit the draft.");
    } finally {
      setLoading(null);
    }
  }

  async function handleFlag() {
    setLoading("flag");
    try {
      await onFlag();
    } finally {
      setLoading(null);
    }
  }

  async function handleAssign() {
    setLocalError(null);
    setLoading("assign");
    try {
      await apiCall(`/api/reviews/${review.id}/workflow`, "POST", { action: "assign", userId: assignee || null });
      toast.success(assignee ? "Review assigned" : "Assignment cleared");
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not assign the review.");
    } finally {
      setLoading(null);
    }
  }

  async function handleAddNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim()) return;
    setLocalError(null);
    setLoading("note");
    try {
      await apiCall(`/api/reviews/${review.id}/workflow`, "POST", { action: "note", body: note.trim() });
      setNote("");
      toast.success("Note saved");
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not save the note.");
    } finally {
      setLoading(null);
    }
  }

  function addContact(kind: ResolutionContactKind) {
    const sentence = resolutionContactSentence(kind, contact);
    if (!sentence) return;
    setContent((current) => insertResolutionContact(current, sentence));
    setEditing(true);
  }

  function followUpHref(): string {
    const query = new URLSearchParams();
    for (const key of ["client", "group", "location"]) {
      const value = searchParams.get(key);
      if (value) query.set(key, value);
    }
    query.set("tab", "follow-ups");
    if (followUp) query.set("id", followUp.id);
    return `/reviews?${query.toString()}`;
  }

  const draftTag = own
    ? "Your words"
    : reply?.source === "ai" && !editedHere
      ? low
        ? "AI draft · read before sending"
        : "AI draft"
      : reply?.source === "ai"
        ? "AI draft, edited"
        : "Your words";

  const flagButton = followUp ? (
    <Link
      href={followUpHref()}
      className="inline-flex h-11 items-center gap-1.5 px-2 text-[13px] font-medium text-info hover:underline"
    >
      <Phone className="size-3.5" aria-hidden />
      Call back is open
    </Link>
  ) : (
    <Button
      type="button"
      variant="ghost"
      className="h-11 px-2 text-[13px]"
      loading={loading === "flag"}
      disabled={busy}
      onClick={() => void handleFlag()}
    >
      Needs a call
    </Button>
  );

  const shownError = localError ?? error;

  return (
    <div className="flex flex-col gap-5">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="-mt-1 inline-flex h-11 items-center gap-1 self-start text-sm font-medium text-ink-2 xl:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          All reviews
        </button>
      ) : null}

      {/* Header */}
      <div className="flex flex-wrap items-start gap-3.5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-line-2 text-sm font-semibold text-ink-2"
        >
          {initials(name)}
        </span>
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
          <span className="text-base font-semibold text-ink">{name}</span>
          <span className="text-[13px] text-ink-3">
            {review.location_title} · {longAge(review.review_create_time)} ago on Google
          </span>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", tag.className)}>{tag.label}</span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            role="img"
            aria-label={`${review.star_rating} out of 5 stars`}
            className="text-lg tracking-[2px] text-star"
          >
            {"★".repeat(review.star_rating)}
            <span className="text-[#d5d9e0]">{"★".repeat(Math.max(0, 5 - review.star_rating))}</span>
          </span>
          {low ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-bad-tint px-2 py-0.5 text-[11px] font-semibold text-bad">
              <AlertCircle className="size-3" aria-hidden />
              Low rating
            </span>
          ) : null}
          {followUp ? (
            <Link
              href={followUpHref()}
              className="inline-flex items-center gap-1 rounded-full bg-info-tint px-2 py-0.5 text-[11px] font-semibold text-info hover:underline"
            >
              <Phone className="size-3" aria-hidden />
              Call back
            </Link>
          ) : null}
        </div>
        {text ? (
          <>
            <p className="text-[15px] leading-relaxed text-ink">{text.original}</p>
            {text.translation ? (
              <p className="text-[13px] leading-relaxed text-ink-3">
                <span className="font-medium text-ink-2">Translation. </span>
                {text.translation}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[15px] italic text-ink-3">Rating only. No written comment.</p>
        )}
      </div>

      {shownError ? (
        <Banner tone="bad" title={stage === "failed" ? "Google did not take this reply." : "That didn’t work."} role="alert">
          {shownError}
        </Banner>
      ) : null}

      {/* No reply yet */}
      {stage === "none" && !own ? (
        <div className="flex flex-col gap-3.5 rounded-xl border border-dashed border-[#c3c9d3] bg-[#fafbfc] p-5">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">No reply yet</span>
            <span className="text-[13px] leading-normal text-ink-3">
              AI can write one in your brand voice using what it knows about {business}. Nothing goes to Google until you
              press Send.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onDraft()} disabled={busy} className={pill("ai")}>
              <Sparkles className="size-[15px]" aria-hidden />
              Draft with AI
            </button>
            <DraftContactMenu contact={contact} disabled={busy || saving} onDraft={(selection) => onDraft(undefined, selection)} />
            {aiOnly ? null : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOwn(true);
                  setEditing(true);
                  setContent("");
                }}
                className={pill("outline")}
              >
                Write my own
              </button>
            )}
            <span className="flex-1" />
            {flagButton}
          </div>
          {undraftedCount > 1 ? (
            <span className="text-xs text-ink-3">
              Or draft all {undraftedCount.toLocaleString("en-US")} at once with the button above.
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Writing */}
      {stage === "writing" ? (
        <div role="status" className="flex flex-col gap-3 border-l-2 border-ai-line pt-4 pb-1 pl-3.5">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ai">
            <Sparkles className="size-[13px]" aria-hidden />
            Writing a reply in your brand voice…
          </span>
          <span className="h-3 w-[94%] animate-pulse rounded-md bg-[#ebe5f8] motion-reduce:animate-none" />
          <span className="h-3 w-[82%] animate-pulse rounded-md bg-[#ebe5f8] motion-reduce:animate-none" />
          <span className="h-3 w-[56%] animate-pulse rounded-md bg-[#ebe5f8] motion-reduce:animate-none" />
        </div>
      ) : null}

      {/* Draft ready (or being written by hand) */}
      {showDraft && stage !== "writing" ? (
        <div className="flex flex-col gap-3 border-l-2 border-ai-line pl-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">Reply from {business}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-ai-tint px-[7px] py-0.5 text-[11px] font-semibold text-ai">
              <Sparkles className="size-2.5" aria-hidden />
              {draftTag}
            </span>
            {reply?.status === "approved" ? <Badge variant="brand">Approved</Badge> : null}
            {saving ? <span className="text-xs text-ink-3">Saving…</span> : null}
          </div>
          {editing ? (
            <>
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                aria-label={`Reply to ${name}`}
                placeholder="Write your reply"
                rows={5}
                autoFocus
                className="resize-y rounded-[10px] border-brand-line p-3 text-sm leading-relaxed"
              />
              <span className={cn("text-xs tabular-nums text-ink-3", content.length > REPLY_MAX && "font-medium text-bad")}>
                {content.length.toLocaleString("en-US")} / {REPLY_MAX.toLocaleString("en-US")} characters
              </span>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{content}</p>
          )}
          {own ? null : (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rewrite with AI">
              <span className="mr-0.5 text-xs text-ink-3">Rewrite</span>
              {(
                [
                  ["shorter", "Shorter"],
                  ["warmer", "Warmer"],
                  ["apology", "Add apology"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  disabled={busy || editing || saving}
                  onClick={() => onDraft(kind)}
                  className="rounded-full bg-paper px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-line-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
              <DraftContactMenu contact={contact} disabled={busy || editing || saving} onDraft={(selection) => onDraft(undefined, selection)} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {canSend ? (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={busy || saving || (own && !content.trim())}
                className={pill("ink")}
              >
                <Send className="size-[15px]" aria-hidden />
                {stage === "failed" ? "Try sending again" : "Send reply"}
              </button>
            ) : reply ? (
              <Button
                type="button"
                className="h-11 rounded-full px-5 text-sm"
                loading={loading === "submit"}
                disabled={busy || saving}
                onClick={() => void handleSubmitForApproval()}
              >
                Submit for approval
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => void saveText()}
                disabled={busy || !content.trim()}
                className={pill("ink")}
              >
                Save draft
              </button>
            )}
            {aiOnly ? null : own ? (
              <button
                type="button"
                className={pill("outline")}
                disabled={loading === "save"}
                onClick={() => {
                  setOwn(false);
                  setEditing(false);
                  setContent(reply?.content ?? "");
                }}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className={pill("outline")}
                disabled={busy || saving}
                onClick={() => {
                  if (editing) void saveText();
                  else setEditing(true);
                }}
              >
                {loading === "save" ? "Saving…" : editing ? "Done" : "Edit"}
              </button>
            )}
            <span className="flex-1" />
            {flagButton}
          </div>
          <span className="text-xs text-ink-3">
            {canSend
              ? `Posts publicly on Google as ${business}. After sending, the next review opens.`
              : aiOnly
                ? "A higher role approves this draft. After that, you can send it."
                : "An owner or admin approves 1–3 star replies before they go to Google."}
          </span>
          {editing && !aiOnly ? <ContactActions contact={contact} onAdd={addContact} /> : null}
        </div>
      ) : null}

      {/* Sending */}
      {stage === "sending" ? (
        <div role="status" className="flex flex-col gap-2 border-l-2 border-ai-line pl-3.5">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ai">
            <Send className="size-[13px]" aria-hidden />
            Sending to Google…
          </span>
          <p className="text-sm leading-relaxed text-ink-3">{content}</p>
        </div>
      ) : null}

      {/* Just sent */}
      {stage === "held" || (stage === "sent" && justSent) ? (
        <div className="flex flex-col gap-2.5 rounded-xl border border-ok-line bg-[#f3faf5] p-4">
          <div className="flex items-center gap-2">
            <Check className="size-4 text-ok" strokeWidth={2.5} aria-hidden />
            <span className="flex-1 text-[13px] font-semibold text-[#14532d]">Sent to Google · just now</span>
            {stage === "held" ? (
              <button
                type="button"
                onClick={onUndo}
                className="rounded-lg border border-ok-line bg-white px-2.5 py-1.5 text-[13px] font-semibold text-[#14532d]"
              >
                Undo
              </button>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed text-ink-2">{reply?.content ?? content}</p>
        </div>
      ) : null}

      {/* Already replied */}
      {(stage === "sent" && !justSent) || stage === "unconfirmed" ? (
        <div className="flex flex-col gap-1.5 border-l-2 border-ok-line pl-3.5">
          <span className="text-[13px] font-semibold text-ink">
            Reply from {business}{" "}
            <span className={cn("font-medium", stage === "unconfirmed" ? "text-warn" : "text-ok")}>
              · {stage === "unconfirmed" ? "waiting for Google to confirm" : "live on Google"}
            </span>
          </span>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
            {reply?.content ?? review.google_reply_comment ?? ""}
          </p>
          {reply?.published_at ? (
            <span className="text-xs text-ink-3">{formatFriendlyDateTime(reply.published_at, "2-digit")}</span>
          ) : review.google_reply_update_time ? (
            <span className="text-xs text-ink-3">{formatFriendlyDateTime(review.google_reply_update_time, "2-digit")}</span>
          ) : null}
        </div>
      ) : null}

      <MoreDetails
        review={review}
        members={members}
        aiOnly={aiOnly}
        assignee={assignee}
        onAssigneeChange={setAssignee}
        onAssign={() => void handleAssign()}
        note={note}
        onNoteChange={setNote}
        onAddNote={handleAddNote}
        loading={loading}
        reply={reply}
      />
    </div>
  );
}

function pill(kind: "ai" | "ink" | "outline"): string {
  return cn(
    "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full px-[18px] text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-50",
    kind === "ai" && "bg-ai text-white hover:bg-[#5b21b6]",
    kind === "ink" && "bg-ink px-[22px] text-white hover:bg-graphite",
    kind === "outline" && "border border-line bg-white px-4 font-medium text-ink hover:bg-paper"
  );
}

function ContactActions({ contact, onAdd }: { contact: ResolutionContact; onAdd: (kind: ResolutionContactKind) => void }) {
  if (!contact.phone && !contact.email) {
    return (
      <p className="text-xs text-ink-3">
        <Link href="/settings?section=sla" className="font-medium text-brand hover:underline">
          Set a resolution phone or email in Settings
        </Link>{" "}
        to add it to replies.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-3">Add contact:</span>
      <Button type="button" size="xs" variant="ghost" disabled={!contact.phone} onClick={() => onAdd("phone")}>
        Phone
      </Button>
      <Button type="button" size="xs" variant="ghost" disabled={!contact.email} onClick={() => onAdd("email")}>
        Email
      </Button>
      <Button type="button" size="xs" variant="ghost" disabled={!contact.phone || !contact.email} onClick={() => onAdd("both")}>
        Both
      </Button>
    </div>
  );
}

/** Owner, internal notes and history: kept, but out of the way of replying. */
function MoreDetails({
  review,
  members,
  aiOnly,
  assignee,
  onAssigneeChange,
  onAssign,
  note,
  onNoteChange,
  onAddNote,
  loading,
  reply,
}: {
  review: InboxReview;
  members: Array<{ id: string; email: string }>;
  aiOnly: boolean;
  assignee: string;
  onAssigneeChange: (value: string) => void;
  onAssign: () => void;
  note: string;
  onNoteChange: (value: string) => void;
  onAddNote: (event: React.FormEvent<HTMLFormElement>) => void;
  loading: string | null;
  reply: InboxReply | null;
}) {
  const notes = review.notes ?? [];
  const theme = themeLabel(review.complaint_theme);
  const language = languageLabel(review.review_language);
  const assigneeEmail = review.assigned_to
    ? (members.find((member) => member.id === review.assigned_to)?.email ?? "a teammate")
    : null;
  const activity = [
    { at: review.review_create_time, label: "Review received" },
    review.review_update_time && review.review_update_time !== review.review_create_time
      ? { at: review.review_update_time, label: "Review edited on Google" }
      : null,
    review.reopened_at ? { at: review.reopened_at, label: "Reopened after a published reply" } : null,
    reply ? { at: reply.created_at, label: "Draft saved" } : null,
    reply?.approved_at ? { at: reply.approved_at, label: "Draft approved" } : null,
    reply?.published_at ? { at: reply.published_at, label: "Reply published" } : null,
    ...(review.activity ?? []),
    ...notes.map((item) => ({ at: item.createdAt, label: "Internal note added" })),
  ]
    .filter((item): item is { at: string; label: string } => Boolean(item))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <details className="group border-t border-line-2 pt-4">
      <summary className="cursor-pointer text-[13px] font-medium text-ink-2 marker:text-ink-3">
        Owner, notes and history
        {notes.length > 0 ? <span className="text-ink-3"> · {notes.length} note{notes.length === 1 ? "" : "s"}</span> : null}
      </summary>
      <div className="mt-4 flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-2">Owner</p>
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
                  onValueChange={onAssigneeChange}
                  className="min-w-0 flex-1"
                  size="sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loading !== null || assignee === (review.assigned_to ?? "")}
                  loading={loading === "assign"}
                  onClick={onAssign}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-2">Details</p>
            <p className="text-[13px] text-ink-2">
              {[language, theme, review.group_name].filter(Boolean).join(" · ") || "No language or complaint theme on this review."}
            </p>
          </div>
        </div>

        <section className="space-y-2" aria-label="Internal notes">
          <h3 className="text-xs font-medium text-ink-2">Internal notes</h3>
          {notes.length === 0 ? (
            <p className="text-xs text-ink-3">No notes yet. Notes stay with your team and are never posted to Google.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((item) => (
                <li key={item.id} className="rounded-lg border border-line px-3 py-2 text-xs">
                  <p className="mb-1 flex justify-between gap-2">
                    <b className="truncate font-semibold text-ink">
                      {members.find((member) => member.id === item.authorId)?.email ?? "Teammate"}
                    </b>
                    <span className="shrink-0 text-ink-3">{formatFriendlyDateTime(item.createdAt, "2-digit")}</span>
                  </p>
                  <p className="text-[13px] text-ink-2">{item.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form className="flex gap-2" onSubmit={onAddNote}>
            <Input
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              maxLength={2000}
              placeholder="Add a note for your team (never published)"
              aria-label="Internal note"
              className="h-8"
            />
            <Button type="submit" size="sm" variant="outline" disabled={loading !== null || !note.trim()} loading={loading === "note"}>
              Add note
            </Button>
          </form>
        </section>

        <section className="space-y-2" aria-label="Activity">
          <h3 className="text-xs font-medium text-ink-2">History</h3>
          <ol className="space-y-1.5 text-xs text-ink-2">
            {activity.map((item, index) => (
              <li key={`${item.label}-${item.at}-${index}`}>
                {item.label} · <span className="text-ink-3">{formatFriendlyDateTime(item.at, "2-digit")}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </details>
  );
}
