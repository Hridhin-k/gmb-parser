"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Phone, Send, Sparkles } from "lucide-react";
import { ContactDraftButton, ContactTag } from "@/components/contact-draft-menu";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InlineStars } from "@/components/reviews-badges";
import { splitGoogleTranslation } from "@/lib/review-text";
import { hasResolutionContact, type ResolutionContact, type ResolutionContactKind } from "@/lib/resolution-contact";
import { useServerRefresh, useSettleWhenUpdated } from "@/hooks/use-server-refresh";
import { pollBulkJob, type BulkJobItemResult } from "@/lib/bulk-job-client";
import { pollAiGeneration } from "@/lib/ai-generation-client";
import {
  ReviewDetailPanel,
  reviewerName,
  type FollowUpRef,
  type InboxReply,
  type InboxReview,
  type RewriteKind,
} from "@/components/review-detail-panel";
import {
  canSendReply,
  defaultPicked,
  isSendable,
  nextOpenId,
  plural,
  replyStage,
  shortAge,
  type ReplyStage,
} from "@/components/reviews-status";

interface ReviewListProps {
  tab: "to-reply" | "sent";
  reviews: InboxReview[];
  replies: Record<string, InboxReply>;
  /** Open follow-ups for reviews on this page, by review id. */
  followUps?: Record<string, FollowUpRef>;
  canApprove: boolean;
  canPublishPositive: boolean;
  /** Members generate with AI and publish only after approval. They cannot type the reply. */
  aiOnly?: boolean;
  contact?: ResolutionContact;
  members?: Array<{ id: string; email: string }>;
  /** Review opened from a link (`?review=`). */
  initialSelectedId?: string | null;
  totalCount: number;
  /** Sort control rendered in the list header. */
  sortControl?: React.ReactNode;
  /** "1–30 of 142" for the list header. */
  rangeLabel?: string;
}

/** How long a sent reply waits before it goes to Google, so Undo can cancel it. */
const UNDO_MS = 5000;

type ReplyPatch = { status: string; reply: InboxReply | null };
type Notice = { text: string; tone: "ok" | "warn" | "bad"; undoId?: string };
type Job = { kind: "draft" | "send"; total: number; done: number; withContact?: boolean };
type Flags = Record<string, true>;

function withFlag(flags: Flags, ids: string[], on: boolean): Flags {
  const next = { ...flags };
  for (const id of ids) {
    if (on) next[id] = true;
    else delete next[id];
  }
  return next;
}

/** Drop local patches the server has caught up with. */
function prunePatches(
  current: Record<string, ReplyPatch>,
  reviews: InboxReview[],
  replies: Record<string, InboxReply>
): Record<string, ReplyPatch> {
  let changed = false;
  const next = { ...current };
  for (const [id, patch] of Object.entries(current)) {
    const server = reviews.find((review) => review.id === id);
    const serverReply = replies[id];
    // The refreshed page is authoritative once a review leaves this tab.
    if (!server) {
      delete next[id];
      changed = true;
      continue;
    }
    const statusOk = server.reply_status === patch.status;
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

function draftReply(id: string, content: string): InboxReply {
  return {
    id,
    content,
    source: "ai",
    status: "draft",
    created_at: new Date().toISOString(),
    approved_at: null,
    published_at: null,
    last_error: null,
    failure_count: 0,
  };
}

export function ReviewList({
  tab,
  reviews,
  replies,
  followUps = {},
  canApprove,
  canPublishPositive,
  aiOnly = false,
  contact = { phone: null, email: null },
  members = [],
  initialSelectedId = null,
  totalCount,
  sortControl,
  rangeLabel,
}: ReviewListProps) {
  const { pending: refreshing, refresh, settle } = useServerRefresh();
  useSettleWhenUpdated(refreshing, settle, reviews);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [sheetOpen, setSheetOpen] = useState(Boolean(initialSelectedId));
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [patches, setPatches] = useState<Record<string, ReplyPatch>>({});
  const [writing, setWriting] = useState<Flags>({});
  const [sending, setSending] = useState<Flags>({});
  const [held, setHeld] = useState<Flags>({});
  const [saving, setSaving] = useState<Flags>({});
  const [sentHere, setSentHere] = useState<Flags>({});
  const [flagged, setFlagged] = useState<Record<string, FollowUpRef>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [panelDirty, setPanelDirty] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<{ id: string | null } | null>(null);
  const holdTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const [serverPayload, setServerPayload] = useState({ reviews, replies });
  if (serverPayload.reviews !== reviews || serverPayload.replies !== replies) {
    setServerPayload({ reviews, replies });
    setPatches((current) => prunePatches(current, reviews, replies));
  }

  const viewReplies = useMemo(() => {
    const next = { ...replies };
    for (const [id, patch] of Object.entries(patches)) {
      if (patch.reply) next[id] = patch.reply;
      else delete next[id];
    }
    return next;
  }, [replies, patches]);
  const viewReviews = useMemo(
    () =>
      reviews.map((review) => {
        const patch = patches[review.id];
        return patch ? { ...review, reply_status: patch.status } : review;
      }).filter((review) => tab !== "to-reply" || review.reply_status !== "published"),
    [reviews, patches, tab]
  );

  const stageOf = useCallback(
    (review: InboxReview): ReplyStage =>
      replyStage({
        replyStatus: review.reply_status,
        hasReply: Boolean(viewReplies[review.id]),
        writing: Boolean(writing[review.id]),
        sending: Boolean(sending[review.id]),
        held: Boolean(held[review.id]),
      }),
    [viewReplies, writing, sending, held]
  );
  const sendAllowed = (review: InboxReview) =>
    canSendReply({
      starRating: review.star_rating,
      // The server checks the reply itself: it can be approved while the review row still says draft.
      replyStatus: viewReplies[review.id]?.status ?? review.reply_status,
      canApprove,
      canPublishPositive,
      aiOnly,
    });

  const rows = viewReviews.map((review) => ({ review, stage: stageOf(review) }));
  const open = tab === "to-reply" ? rows.filter((row) => !["held", "sending", "sent", "unconfirmed"].includes(row.stage)) : [];
  const idle = open.filter((row) => row.stage !== "writing");
  const isPicked = (row: (typeof rows)[number]) =>
    picks[row.review.id] ?? defaultPicked(row.review.star_rating, isSendable(row.stage));
  const picked = idle.filter(isPicked);
  const undrafted = idle.filter((row) => row.stage === "none");
  const drafts = idle.filter((row) => isSendable(row.stage));
  const pickDraft = undrafted.filter(isPicked);
  const pickSend = drafts.filter((row) => isPicked(row) && sendAllowed(row.review));
  const noDrafts = drafts.length === 0;

  const selected = rows.find((row) => row.review.id === selectedId) ?? null;
  const current = selected ?? open[0] ?? rows[0] ?? null;
  const currentId = current?.review.id ?? null;

  /** Change the open review, asking first when the panel has unsaved edits. */
  function requestSelect(id: string | null, openSheet = true) {
    if (id === currentId && id !== null) {
      if (openSheet) setSheetOpen(true);
      return;
    }
    if (panelDirty && currentId) {
      setPendingTarget({ id });
      return;
    }
    setSelectedId(id);
    if (openSheet) setSheetOpen(id !== null);
  }

  useEffect(() => {
    if (!sheetOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && !pendingTarget) setSheetOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, pendingTarget]);

  // Leaving the page must not lose a send that is waiting out its Undo window.
  useEffect(() => {
    const timers = holdTimers.current;
    function flush() {
      const ids = [...timers.keys()];
      if (ids.length === 0) return;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      void fetch("/api/reviews/bulk", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", reviewIds: ids }),
      }).catch(() => undefined);
    }
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  function nameOf(id: string): string {
    const review = viewReviews.find((item) => item.id === id);
    return review ? reviewerName(review) : "this customer";
  }

  function setError(id: string, message: string | null) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  function patchReply(id: string, status: string, reply: InboxReply | null) {
    setPatches((prev) => ({ ...prev, [id]: { status, reply } }));
  }

  function selectNext(afterId: string, skip: string[] = []) {
    const openIds = open.map((row) => row.review.id);
    const next = nextOpenId(openIds, afterId, new Set([...skip, ...Object.keys(held), ...Object.keys(sending)]));
    if (next) setSelectedId(next);
  }

  // ── Drafting ─────────────────────────────────────────────────────────────

  /** Watches the background save of a fresh AI draft; swaps in the real reply id. */
  function watchSave(reviewId: string, jobId: string, content: string) {
    setSaving((prev) => withFlag(prev, [reviewId], true));
    void pollAiGeneration(jobId).then((result) => {
      setSaving((prev) => withFlag(prev, [reviewId], false));
      if (result.status === "saved") {
        if (result.replyId) patchReply(reviewId, "draft", draftReply(result.replyId, content));
        refresh();
      } else if (result.status !== "superseded") {
        setError(reviewId, "The draft is on screen but was not saved. Draft it again before sending.");
      }
    });
  }

  async function draftOne(id: string, rewrite?: RewriteKind, contactKind: ResolutionContactKind | null = null) {
    if (writing[id] || saving[id]) return;
    setError(id, null);
    setWriting((prev) => withFlag(prev, [id], true));
    try {
      const base = rewrite
        ? { adjustment: rewrite, replaceEdited: true }
        : viewReplies[id]
          ? { adjustment: "regenerate", replaceEdited: true }
          : null;
      const body = contactKind ? { ...(base ?? {}), contact: contactKind } : base;
      const response = await fetch(`/api/reviews/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        replyId?: string;
        content?: string;
        jobId?: string | null;
      };
      if (!response.ok) throw new Error(data.error ?? "Couldn't write a draft. Try again.");
      if (data.content && data.replyId) {
        patchReply(id, "draft", draftReply(data.replyId, data.content));
        if (data.jobId) watchSave(id, data.jobId, data.content);
      }
      if (!data.jobId) refresh();
    } catch (caught) {
      setError(id, caught instanceof Error ? caught.message : "Couldn't write a draft. Try again.");
    } finally {
      setWriting((prev) => withFlag(prev, [id], false));
    }
  }

  /** Starts a queued bulk job and reports each finished item as it lands. */
  async function runBulk(
    action: "generate" | "publish",
    ids: string[],
    onItem: (item: BulkJobItemResult) => void,
    contactKind: ResolutionContactKind | null = null
  ): Promise<{ ok: number; failed: number; firstError?: string } | { error: string }> {
    const response = await fetch("/api/reviews/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contactKind ? { action, reviewIds: ids, contact: contactKind } : { action, reviewIds: ids }),
    }).catch(() => null);
    if (!response) return { error: "No connection. Nothing was sent. Check your network and try again." };
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      jobId?: string;
      results?: BulkJobItemResult[];
    };
    if (!response.ok) return { error: data.error ?? "That didn’t work. Try again." };
    const seen = new Set<string>();
    const report = (items: BulkJobItemResult[] = []) => {
      for (const item of items) {
        if (!item.reviewId || seen.has(item.reviewId)) continue;
        seen.add(item.reviewId);
        onItem(item);
      }
      setJob((prev) => (prev ? { ...prev, done: seen.size } : prev));
    };
    let results = data.results;
    if (data.jobId) {
      const final = await pollBulkJob(data.jobId, { intervalMs: 1000, onProgress: (outcome) => report(outcome.results) });
      report(final.results);
      if (final.status !== "done") {
        return { error: final.error ?? "That didn’t finish. Check the reviews and try again." };
      }
      results = final.results;
    } else {
      report(results);
    }
    const all = results ?? [];
    return {
      ok: all.filter((item) => item.ok).length,
      failed: all.filter((item) => !item.ok).length,
      firstError: all.find((item) => !item.ok)?.error,
    };
  }

  async function bulkDraft(contactKind: ResolutionContactKind | null = null) {
    const ids = pickDraft.map((row) => row.review.id);
    if (ids.length === 0 || job) return;
    setNotice(null);
    setWriting((prev) => withFlag(prev, ids, true));
    setJob({ kind: "draft", total: ids.length, done: 0, withContact: Boolean(contactKind) });
    const outcome = await runBulk(
      "generate",
      ids,
      (item) => {
        setWriting((prev) => withFlag(prev, [item.reviewId], false));
        if (item.ok && item.replyId && item.content) patchReply(item.reviewId, "draft", draftReply(item.replyId, item.content));
        else if (!item.ok) setError(item.reviewId, item.error ?? "Couldn't write a draft.");
      },
      contactKind
    );
    setWriting((prev) => withFlag(prev, ids, false));
    setJob(null);
    if ("error" in outcome) {
      setNotice({ text: outcome.error, tone: "bad" });
    } else if (outcome.failed > 0) {
      setNotice({
        text: `${plural(outcome.ok, "reply", "replies")} drafted, ${outcome.failed} not. ${outcome.firstError ?? ""}`.trim(),
        tone: "warn",
      });
    } else if (outcome.ok > 1) {
      setNotice({ text: `${outcome.ok} replies drafted. Read them, then send.`, tone: "ok" });
    }
    refresh();
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  async function commitSend(ids: string[], bulk: boolean) {
    setHeld((prev) => withFlag(prev, ids, false));
    setSending((prev) => withFlag(prev, ids, true));
    if (bulk) setJob({ kind: "send", total: ids.length, done: 0 });
    const outcome = await runBulk("publish", ids, (item) => {
      setSending((prev) => withFlag(prev, [item.reviewId], false));
      if (item.ok) {
        const existing = viewReplies[item.reviewId];
        patchReply(
          item.reviewId,
          "published",
          existing ? { ...existing, status: "published", published_at: new Date().toISOString() } : null
        );
        setSentHere((prev) => withFlag(prev, [item.reviewId], true));
      } else {
        setError(item.reviewId, item.error ?? "Google did not take this reply.");
      }
    });
    setSending((prev) => withFlag(prev, ids, false));
    if (bulk) setJob(null);
    if ("error" in outcome) {
      for (const id of ids) setError(id, outcome.error);
      setNotice({ text: outcome.error, tone: "bad" });
    } else if (outcome.failed > 0) {
      setNotice({
        text: bulk
          ? `${plural(outcome.ok, "reply", "replies")} sent, ${outcome.failed} not sent. ${outcome.firstError ?? ""}`.trim()
          : `The reply to ${nameOf(ids[0]!)} was not sent. ${outcome.firstError ?? ""}`.trim(),
        tone: bulk && outcome.ok > 0 ? "warn" : "bad",
      });
    } else if (bulk) {
      setNotice({ text: `${plural(outcome.ok, "reply", "replies")} sent to Google.`, tone: "ok" });
    } else {
      // The Undo window is over: keep the confirmation, drop the button.
      setNotice((prev) => (prev?.undoId === ids[0] ? { text: `Reply to ${nameOf(ids[0]!)} sent to Google.`, tone: "ok" } : prev));
    }
    refresh();
  }

  /** One-click send: holds the reply for a few seconds so Undo can cancel it. */
  function queueSend(id: string) {
    if (held[id] || sending[id]) return;
    if (saving[id]) {
      setError(id, "This draft is still saving. Give it a second, then send.");
      return;
    }
    setError(id, null);
    setHeld((prev) => withFlag(prev, [id], true));
    setNotice({ text: `Reply to ${nameOf(id)} queued to send.`, tone: "ok", undoId: id });
    selectNext(id, [id]);
    holdTimers.current.set(
      id,
      setTimeout(() => {
        holdTimers.current.delete(id);
        void commitSend([id], false);
      }, UNDO_MS)
    );
  }

  function undoSend(id: string) {
    const timer = holdTimers.current.get(id);
    if (!timer) return;
    clearTimeout(timer);
    holdTimers.current.delete(id);
    setHeld((prev) => withFlag(prev, [id], false));
    setSelectedId(id);
    setNotice(null);
  }

  function bulkSend() {
    const ids = pickSend.map((row) => row.review.id);
    if (ids.length === 0 || job) return;
    setNotice(null);
    void commitSend(ids, true);
  }

  async function flagOne(id: string) {
    setError(id, null);
    const response = await fetch("/api/escalations/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: id }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as { id?: string; error?: string } | undefined;
    if (!response?.ok || !data?.id) {
      setError(id, data?.error ?? "Could not add a call-back. Try again.");
      return;
    }
    setFlagged((prev) => ({ ...prev, [id]: { id: data.id!, dueAt: new Date().toISOString() } }));
    setNotice({ text: `${nameOf(id)} moved to Follow-ups.`, tone: "ok" });
    selectNext(id);
    refresh();
  }

  function toggleAll() {
    const allOn = picked.length === idle.length;
    setPicks((prev) => {
      const next = { ...prev };
      for (const row of idle) next[row.review.id] = !allOn;
      return next;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const showBar = tab === "to-reply" && (idle.length > 0 || job !== null);
  const jobPct = job ? Math.round((job.done / Math.max(1, job.total)) * 100) : 0;
  const currentReply = current ? (viewReplies[current.review.id] ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <div
          role="status"
          className={cn(
            "flex flex-wrap items-center gap-2.5 rounded-[10px] border py-2.5 pr-3 pl-4 text-sm",
            notice.tone === "ok" && "border-ok-line bg-ok-tint text-[#14532d]",
            notice.tone === "warn" && "border-warn-line bg-warn-tint text-[#7c2d12]",
            notice.tone === "bad" && "border-bad-line bg-bad-tint text-[#7f1d1d]"
          )}
        >
          {notice.tone === "ok" ? <Check className="size-4" strokeWidth={2} aria-hidden /> : null}
          <span className="flex-1">{notice.text}</span>
          {notice.undoId && held[notice.undoId] ? (
            <button
              type="button"
              onClick={() => undoSend(notice.undoId!)}
              className="rounded-lg border border-ok-line bg-white px-2.5 py-1.5 text-[13px] font-semibold"
            >
              Undo
            </button>
          ) : null}
          <button type="button" onClick={() => setNotice(null)} className="px-2 py-1.5 text-[13px] font-medium">
            Dismiss
          </button>
        </div>
      ) : null}

      {showBar ? (
        <div className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-line bg-white py-2.5 pr-3 pl-4 shadow-[0_6px_16px_rgba(20,24,31,0.05)]">
          {job ? (
            <div role="status" className="flex flex-1 flex-col gap-2 py-1 pr-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-sm">
                {job.kind === "send" ? (
                  <Send className="size-4 text-ai" aria-hidden />
                ) : (
                  <Sparkles className="size-4 text-ai" aria-hidden />
                )}
                <span className="font-semibold">
                  {job.kind === "send" ? "Sending replies to Google" : job.withContact ? "Drafting replies with contact details" : "Drafting replies with AI"}
                </span>
                <span className="text-ink-3 tabular-nums">
                  {job.done} of {job.total}
                </span>
                <span className="flex-1" />
                <span className="text-[13px] text-ink-3">
                  {job.kind === "send"
                    ? "Each reply posts as its business."
                    : job.withContact
                      ? "Your saved contact line ends each draft. Replies appear in the list as they’re written."
                      : "Replies appear in the list as they’re written."}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line-2">
                <div
                  className="h-1.5 rounded-full bg-ai transition-[width] duration-300 ease-linear"
                  style={{ width: `${jobPct}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium">
                <Checkbox
                  className="size-[18px]"
                  checked={idle.length > 0 && picked.length === idle.length}
                  indeterminate={picked.length > 0 && picked.length < idle.length}
                  onCheckedChange={() => toggleAll()}
                  aria-label="Select every review on this page"
                />
                {picked.length} of {idle.length} selected
              </label>
              <span className="hidden min-w-0 flex-[1_1_200px] text-[13px] text-ink-3 sm:block">
                {noDrafts
                  ? "AI writes each reply in your brand voice. Nothing goes to Google until you send."
                  : drafts.some((row) => !sendAllowed(row.review))
                    ? "Drafts you can’t post wait for someone who can approve them."
                    : "1 and 2 star replies start unticked so you read them first."}
              </span>
              {undrafted.length > 0 ? (
                <ContactDraftButton
                  label={noDrafts ? `Draft ${plural(pickDraft.length, "reply", "replies")} with AI` : `Draft ${pickDraft.length} more`}
                  plainLabel={`Draft ${plural(pickDraft.length, "reply", "replies")}`}
                  contact={contact}
                  disabled={pickDraft.length === 0}
                  tone={noDrafts ? "solid" : "soft"}
                  onDraft={(kind) => void bulkDraft(kind)}
                />
              ) : null}
              {noDrafts ? null : (
                <button
                  type="button"
                  onClick={bulkSend}
                  disabled={pickSend.length === 0}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-[22px] text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="size-4" aria-hidden />
                  Send {plural(pickSend.length, "reply", "replies")}
                </button>
              )}
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] xl:items-start">
        <section aria-label="Review list" className="min-w-0 overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-2 text-xs text-ink-3">
            {rangeLabel ? <span className="tabular-nums">{rangeLabel}</span> : null}
            <span className="ml-auto">{sortControl}</span>
          </div>
          <ul>
            {rows.length === 0 ? <li className="px-4 py-6 text-sm text-ink-3" role="status">All reviews on this page have been replied to. Updating the queue…</li> : null}
            {rows.map(({ review, stage }) => {
              const id = review.id;
              const active = id === currentId;
              const name = reviewerName(review);
              const text = review.comment ? splitGoogleTranslation(review.comment).original : null;
              const reply = viewReplies[id];
              const selectable = tab === "to-reply" && idle.some((row) => row.review.id === id);
              const followUp = flagged[id] ?? followUps[id];
              return (
                <li
                  key={id}
                  className={cn(
                    "flex flex-col gap-2 border-b border-line-2 px-4 py-3.5 last:border-b-0",
                    active ? "bg-[#f3f6fe] shadow-[inset_3px_0_0_var(--color-brand)]" : "bg-white"
                  )}
                >
                  <div className="flex items-start gap-3">
                    {selectable ? (
                      <Checkbox
                        className="mt-0.5 size-[18px]"
                        checked={isPicked({ review, stage })}
                        onCheckedChange={(next) => setPicks((prev) => ({ ...prev, [id]: next }))}
                        aria-label={`Select review from ${name}`}
                      />
                    ) : (
                      <span aria-hidden className="w-[18px] shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={() => requestSelect(id)}
                      aria-current={active ? "true" : undefined}
                      aria-label={`Open review by ${name}, ${review.star_rating} stars`}
                      className="flex min-w-0 flex-1 flex-col gap-[5px] rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-line"
                    >
                      <span className="flex items-baseline gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{name}</span>
                        <span className="whitespace-nowrap text-xs text-ink-3">{shortAge(review.review_create_time)}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
                        <InlineStars rating={review.star_rating} />
                        <span className="truncate">{review.location_title}</span>
                        {followUp ? (
                          <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-info">
                            <Phone className="size-3" aria-hidden />
                            Call back
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "line-clamp-2 text-[13px] leading-[1.45]",
                          text ? "text-ink-2" : "italic text-ink-3"
                        )}
                      >
                        {text || "Rating only. No written comment."}
                      </span>
                    </button>
                  </div>
                  <StatusLine
                    tab={tab}
                    stage={stage}
                    reply={reply}
                    name={name}
                    sentHere={Boolean(sentHere[id])}
                    canSend={sendAllowed(review)}
                    error={errors[id] ?? null}
                    onSend={() => queueSend(id)}
                    onUndo={() => undoSend(id)}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        {current ? (
          <>
            {sheetOpen ? (
              <div className="fixed inset-0 z-40 bg-ink/30 xl:hidden" role="presentation" onClick={() => setSheetOpen(false)} />
            ) : null}
            <section
              aria-label="Selected review"
              className={cn(
                "min-w-0 bg-white xl:sticky xl:top-[84px] xl:block xl:max-h-[calc(100dvh-100px)] xl:overflow-y-auto xl:rounded-xl xl:border xl:border-line xl:p-6",
                sheetOpen
                  ? "fixed inset-x-0 bottom-0 top-8 z-50 overflow-y-auto rounded-t-2xl p-4 pb-8 shadow-[0_-8px_24px_rgba(20,24,31,0.12)] sm:p-6 xl:inset-auto xl:z-auto xl:shadow-none"
                  : "hidden"
              )}
            >
              <ReviewDetailPanel
                key={current.review.id}
                review={current.review}
                reply={currentReply}
                stage={current.stage}
                justSent={Boolean(sentHere[current.review.id])}
                saving={Boolean(saving[current.review.id])}
                error={errors[current.review.id] ?? null}
                canSend={sendAllowed(current.review)}
                aiOnly={aiOnly}
                contact={contact}
                members={members}
                followUp={flagged[current.review.id] ?? followUps[current.review.id] ?? null}
                undraftedCount={undrafted.length}
                onDraft={(rewrite, contactKind) => void draftOne(current.review.id, rewrite, contactKind)}
                onSend={() => queueSend(current.review.id)}
                onUndo={() => undoSend(current.review.id)}
                onFlag={() => flagOne(current.review.id)}
                onSaved={(reply) => {
                  setError(current.review.id, null);
                  patchReply(current.review.id, reply.status, reply);
                }}
                onDirtyChange={setPanelDirty}
                onClose={() => setSheetOpen(false)}
              />
            </section>
          </>
        ) : null}
      </div>

      {totalCount > rows.length && tab === "to-reply" && idle.length > 0 ? (
        <p className="text-xs text-ink-3">
          The bar above works on this page. {plural(totalCount, "review", "reviews")} in all.
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingTarget !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingTarget(null);
        }}
        title="Discard your edits to this reply?"
        description="You changed the reply but have not saved it. Cancel to keep editing, or discard the changes."
        confirmLabel="Discard edits"
        tone="danger"
        onConfirm={() => {
          const target = pendingTarget;
          setPanelDirty(false);
          setPendingTarget(null);
          if (target) {
            setSelectedId(target.id);
            setSheetOpen(target.id !== null);
          }
        }}
      />
    </div>
  );
}

function StatusLine({
  tab,
  stage,
  reply,
  name,
  sentHere,
  canSend,
  error,
  onSend,
  onUndo,
}: {
  tab: "to-reply" | "sent";
  stage: ReplyStage;
  reply: InboxReply | undefined;
  name: string;
  sentHere: boolean;
  canSend: boolean;
  error: string | null;
  onSend: () => void;
  onUndo: () => void;
}) {
  const word = reply?.source === "ai" ? (reply.status === "approved" ? "Approved" : "Draft ready") : "Your reply";
  return (
    <div className="flex flex-col gap-1 pl-[30px]">
      <div className="flex min-h-[34px] items-center gap-2">
        {stage === "none" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#c3c9d3] px-[9px] py-[3px] text-xs font-medium text-ink-3">
            <span aria-hidden className="size-1.5 rounded-full bg-[#9aa3b2]" />
            No reply yet
          </span>
        ) : null}
        {stage === "writing" || stage === "sending" ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ai">
              <Sparkles className="size-3" aria-hidden />
              {stage === "sending" ? "Sending…" : "Writing reply…"}
            </span>
            <span aria-hidden className="h-2 flex-1 animate-pulse rounded-md bg-[#ebe5f8] motion-reduce:animate-none" />
          </>
        ) : null}
        {stage === "draft" || stage === "failed" ? (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
              {stage === "failed" ? (
                <span className="whitespace-nowrap font-semibold text-bad">Not sent</span>
              ) : (
                <>
                  <Sparkles className="size-3 shrink-0 text-ai" aria-hidden />
                  <span className="whitespace-nowrap font-semibold text-[#5b21b6]">{word}</span>
                  {hasResolutionContact(reply?.content) ? <ContactTag /> : null}
                </>
              )}
              <span className="truncate text-ink-3">{reply?.content || "Not written yet"}</span>
            </span>
            {canSend ? (
              <button
                type="button"
                onClick={onSend}
                aria-label={`Send reply to ${name}`}
                className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 text-xs font-semibold text-white hover:bg-graphite"
              >
                <Send className="size-3" aria-hidden />
                {stage === "failed" ? "Retry" : "Send"}
              </button>
            ) : (
              <span className="shrink-0 text-xs text-ink-3">Needs approval</span>
            )}
          </>
        ) : null}
        {stage === "held" || stage === "sent" ? (
          <>
            <span className="inline-flex flex-1 items-center gap-1.5 text-xs font-semibold text-ok">
              <Check className="size-[13px]" strokeWidth={2.5} aria-hidden />
              {stage === "held" || (sentHere && tab === "to-reply") ? "Sent to Google just now" : "Replied · live on Google"}
            </span>
            {stage === "held" ? (
              <button
                type="button"
                onClick={onUndo}
                className="rounded-lg px-2 py-1.5 text-xs font-semibold text-[#14532d] hover:bg-ok-tint"
              >
                Undo
              </button>
            ) : null}
          </>
        ) : null}
        {stage === "unconfirmed" ? (
          <span className="text-xs font-semibold text-warn">Waiting for Google to confirm</span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
