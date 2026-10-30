"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, RotateCcw, Sparkles } from "lucide-react";
import { SpeakButton } from "@/components/mobile-speech";
import { MobileReviewQuote, MobileStickyBar, OFFLINE_MESSAGE } from "@/components/mobile-shared";
import { StarRating } from "@/components/star-rating";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { REPLY_LANGUAGES, type ReplyLanguage } from "@/lib/reply-adjustments";
import { checkReplyGuardrails } from "@/lib/reply-guardrails";
import {
  insertResolutionContact,
  resolutionContactSentence,
  type ResolutionContactKind,
} from "@/lib/resolution-contact";
import type { MobileApproval } from "@/lib/services/mobile-work";
import { mobileHref } from "@/lib/mobile-work";
import { useServerRefresh } from "@/hooks/use-server-refresh";
import { pollBulkJob } from "@/lib/bulk-job-client";
import { cn } from "@/lib/utils";

async function errorText(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || "That did not save.";
}

export function MobileApprovalView({ data }: { data: MobileApproval }) {
  const router = useRouter();
  const { refresh } = useServerRefresh();
  const card = data.card;
  const [content, setContent] = useState(card?.content ?? "");
  const [replyId, setReplyId] = useState(card?.replyId ?? null);
  const [replyStatus, setReplyStatus] = useState(card?.replyStatus ?? null);
  const [language, setLanguage] = useState<ReplyLanguage>("en");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const dirty = card ? content !== card.content : false;
  const violations = checkReplyGuardrails(content).map((item) => item.message);
  const publishable = card?.publishableIds.length ?? 0;

  /** Network failures (no signal) throw instead of returning a response. Say so and offer a retry. */
  function guarded(action: () => Promise<void>) {
    return async () => {
      setRetry(null);
      try {
        await action();
      } catch {
        setPending(null);
        setNotice(null);
        setError(OFFLINE_MESSAGE);
        setRetry(() => action);
      }
    };
  }

  async function generate(body: { adjustment?: "regenerate" | "shorter" | "warmer"; language?: ReplyLanguage }) {
    if (!card) return;
    setPending("generate");
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/reviews/${card.reviewId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, replaceEdited: true }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      setPending(null);
      return;
    }
    const payload = (await response.json()) as { replyId?: string; content?: string };
    if (payload.content) setContent(payload.content);
    if (payload.replyId) setReplyId(payload.replyId);
    setReplyStatus("draft");
    setNotice("Draft is ready. Read it before you approve.");
    setPending(null);
    refresh();
  }

  async function saveDraft(): Promise<string | null> {
    if (!card) return null;
    if (!content.trim()) {
      setError("Write a reply before saving it.");
      return null;
    }
    if (replyId && !dirty) return replyId;
    const response = await fetch(`/api/reviews/${card.reviewId}/reply`, {
      method: replyId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(replyId ? { replyId, content } : { content }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      return null;
    }
    const payload = (await response.json()) as { id?: string };
    const id = payload.id ?? replyId;
    if (id) setReplyId(id);
    setReplyStatus("draft");
    return id;
  }

  async function approveAndPost() {
    if (!card?.canPublish) return;
    setPending("publish");
    setError(null);
    setNotice(null);
    const id = await saveDraft();
    if (!id) {
      setPending(null);
      return;
    }
    if (dirty || replyStatus !== "approved") {
      const approved = await fetch(`/api/reviews/${card.reviewId}/reply/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyId: id }),
      });
      if (!approved.ok) {
        setError(await errorText(approved));
        setPending(null);
        return;
      }
      setReplyStatus("approved");
    }
    const published = await fetch(`/api/reviews/${card.reviewId}/reply/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replyId: id }),
    });
    if (!published.ok) {
      setError(await errorText(published));
      setPending(null);
      router.refresh();
      return;
    }
    setNotice("Posted to Google.");
    setPending(null);
    router.refresh();
  }

  async function sendForApproval() {
    if (!card) return;
    setPending("submit");
    setError(null);
    setNotice(null);
    const id = await saveDraft();
    if (!id) {
      setPending(null);
      return;
    }
    const submitted = await fetch(`/api/reviews/${card.reviewId}/reply/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replyId: id }),
    });
    if (!submitted.ok) {
      setError(await errorText(submitted));
      setPending(null);
      return;
    }
    setNotice("Saved as a draft for approval. It was not posted to Google.");
    setPending(null);
    router.refresh();
  }

  async function needsManager() {
    if (!card) return;
    setPending("escalate");
    setError(null);
    const response = await fetch("/api/escalations/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: card.reviewId }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      setPending(null);
      return;
    }
    const payload = (await response.json()) as { id?: string };
    setPending(null);
    router.push(payload.id ? `/m/escalations?id=${payload.id}` : "/m/escalations");
    router.refresh();
  }

  async function postReady() {
    if (!card || publishable === 0) return;
    setPending("all");
    setError(null);
    const response = await fetch("/api/reviews/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", reviewIds: card.publishableIds }),
    });
    let payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      jobId?: string;
      succeeded?: number;
      failed?: number;
    };
    if (!response.ok) {
      setError(payload.error || "Those replies were not posted.");
      setPending(null);
      return;
    }
    // Publish runs as a queued job: wait for its real counts.
    if (payload.jobId) {
      const final = await pollBulkJob(payload.jobId);
      if (final.status !== "done") {
        setError(final.error || "Those replies were not posted.");
        setPending(null);
        return;
      }
      payload = { ...payload, succeeded: final.succeeded, failed: final.failed };
    }
    setNotice(
      `${payload.succeeded ?? 0} posted to Google. ${payload.failed ?? 0} could not be posted.`
    );
    setConfirmPost(false);
    setPending(null);
    router.refresh();
  }

  const skipHref = card
    ? mobileHref("/m/approve", {
        client: data.clientId,
        group: data.groupId,
        location: data.locationId,
        skip: [...data.skippedIds, card.reviewId].join(","),
      })
    : data.clearSkipHref;

  if (!card) {
    return (
      <div className="space-y-4 text-[15px]">
        <h1 className="text-xl font-semibold text-ink">Approve</h1>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-white px-5 py-10 text-center" role="status">
          <CheckCircle2 className="size-8 text-ok" strokeWidth={1.5} aria-hidden />
          <p className="text-[15px] font-semibold text-ink">No replies are waiting for a decision</p>
          <p className="text-[13px] text-ink-3">Drafts you skip stay in the queue.</p>
          {data.skippedIds.length > 0 ? (
            <Link
              href={data.clearSkipHref}
              className="mt-2 inline-flex h-12 items-center rounded-md border border-line px-4 text-[15px] font-medium text-ink"
            >
              Show {data.skippedIds.length} skipped
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const busy = pending !== null;

  return (
    <div className="space-y-3 text-[15px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">Approve</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {card.position} of {card.total}
            {card.skipped > 0 ? ` · ${card.skipped} skipped, still drafts` : ""}
          </p>
        </div>
        <Badge variant="ai">{card.total.toLocaleString("en-US")} waiting</Badge>
      </div>

      {publishable > 0 && card.canPublish ? (
        confirmPost ? (
          <Banner
            tone="neutral"
            icon={false}
            title={`Post ${publishable} repl${publishable === 1 ? "y" : "ies"} of 4–5 stars to Google?`}
          >
            Replies that fail a check are left out.
            <div className="mt-2 flex gap-2">
              <Button type="button" className="h-12 flex-1 text-[15px]" loading={pending === "all"} onClick={guarded(postReady)}>
                Post {publishable}
              </Button>
              <Button type="button" variant="outline" className="h-12 flex-1 text-[15px]" onClick={() => setConfirmPost(false)}>
                Cancel
              </Button>
            </div>
          </Banner>
        ) : (
          <Button type="button" variant="outline" className="h-12 w-full text-[15px]" disabled={busy} onClick={() => setConfirmPost(true)}>
            Approve and post {publishable} of 4–5 stars
          </Button>
        )
      ) : null}

      <article className="space-y-3 rounded-lg border border-line bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
          <StarRating rating={card.starRating} />
          <span className="font-semibold text-ink">{card.reviewerName}</span>
          <span>· {card.locationName}</span>
          {card.when ? <span>· {card.when}</span> : null}
        </div>
        {card.sameNameCount > 1 ? (
          <p className="text-[13px] text-ink-3">{card.sameNameCount} stored reviews use this display name.</p>
        ) : null}

        <MobileReviewQuote original={card.original} translation={card.translation} />

        <div
          className={cn(
            "overflow-hidden rounded-lg border",
            dirty ? "border-line bg-white" : "border-ai-line bg-[#fbf9ff]"
          )}
        >
          <div className={cn("flex items-center gap-2 border-b px-3 py-2", dirty ? "border-line" : "border-ai-line")}>
            {dirty ? <Badge variant="outline">Edited</Badge> : <Badge variant="ai">Suggested reply</Badge>}
            {replyStatus === "approved" ? <Badge variant="brand">Approved</Badge> : null}
            <span className="flex-1" />
            <span className="text-xs tabular-nums text-ink-3">{content.length} chars</span>
          </div>
          <label htmlFor="mobile-reply" className="sr-only">
            Suggested reply
          </label>
          <textarea
            id="mobile-reply"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={!card.canDraft || busy}
            rows={6}
            className="block w-full resize-y border-0 bg-transparent px-3 py-3 text-[15px] leading-6 text-ink outline-none"
          />
          {card.canDraft ? (
            <div className={cn("flex flex-wrap gap-2 border-t px-3 py-2", dirty ? "border-line" : "border-ai-line")}>
              <Button type="button" variant="ai" className="h-12 px-4 text-[15px]" loading={pending === "generate"} disabled={busy} onClick={guarded(() => generate({ adjustment: "regenerate" }))}>
                <Sparkles aria-hidden />
                Try again
              </Button>
              <Button type="button" variant="outline" className="h-12 px-4 text-[15px]" disabled={busy} onClick={guarded(() => generate({ adjustment: "shorter" }))}>
                Shorter
              </Button>
              <Button type="button" variant="outline" className="h-12 px-4 text-[15px]" disabled={busy} onClick={guarded(() => generate({ adjustment: "warmer" }))}>
                Warmer
              </Button>
            </div>
          ) : null}
        </div>

        <p
          className={cn(
            "text-[13px]",
            content.trim().length === 0 ? "text-ink-3" : violations.length === 0 ? "text-ok" : "text-warn"
          )}
        >
          {content.trim().length === 0
            ? "No reply yet."
            : violations.length === 0
              ? "The reply checks passed."
              : violations[0]}
        </p>

        {card.canDraft ? (
          <div className="space-y-3">
            <ResolutionContactButtons
              phone={data.resolutionPhone}
              email={data.resolutionEmail}
              disabled={busy}
              onAdd={(kind) => {
                const sentence = resolutionContactSentence(kind, {
                  phone: data.resolutionPhone,
                  email: data.resolutionEmail,
                });
                if (!sentence) return;
                setContent((current) => insertResolutionContact(current, sentence));
              }}
            />
            <label className="block text-[13px] font-medium text-ink-2" htmlFor="reply-language">
              Reply language
              <select
                id="reply-language"
                value={language}
                onChange={(event) => {
                  const next = event.target.value as ReplyLanguage;
                  setLanguage(next);
                  void guarded(() => generate({ language: next }))();
                }}
                disabled={busy}
                className="mt-1 h-12 w-full rounded-md border border-line bg-white px-3 text-[15px] text-ink"
              >
                {REPLY_LANGUAGES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <SpeakButton onText={(text) => setContent((current) => (current ? `${current} ${text}` : text))} disabled={busy} />
              <p className="min-w-0 flex-1 text-xs text-ink-3">Speak appears when this browser can capture speech. Typing always works.</p>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">You can read this reply. You cannot change it.</p>
        )}
      </article>

      {error ? (
        <Banner
          tone="bad"
          actions={
            retry ? (
              <Button type="button" variant="outline" className="h-12 px-4 text-[15px]" onClick={() => void guarded(retry)()}>
                <RotateCcw aria-hidden />
                Retry
              </Button>
            ) : null
          }
        >
          {error}
        </Banner>
      ) : null}
      {notice ? <Banner tone="ok">{notice}</Banner> : null}

      <MobileStickyBar>
        {card.canPublish ? (
          <Button type="button" className="h-12 w-full text-[15px]" loading={pending === "publish"} disabled={busy} onClick={guarded(approveAndPost)}>
            Approve and post
          </Button>
        ) : card.canDraft ? (
          <Button type="button" className="h-12 w-full text-[15px]" loading={pending === "submit"} disabled={busy} onClick={guarded(sendForApproval)}>
            Send for approval
          </Button>
        ) : null}
        <div className="flex gap-2">
          {card.canDraft ? (
            card.openEscalationId ? (
              <Link
                href={mobileHref("/m/escalations", { client: data.clientId, group: data.groupId, location: data.locationId, id: card.openEscalationId })}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-md border border-line bg-white text-[15px] font-medium text-ink"
              >
                Open the case
              </Link>
            ) : (
              <Button type="button" variant="outline" className="h-12 flex-1 text-[15px]" loading={pending === "escalate"} disabled={busy} onClick={guarded(needsManager)}>
                Needs a manager
              </Button>
            )
          ) : null}
          <Link
            href={skipHref}
            className="inline-flex h-12 flex-1 items-center justify-center rounded-md text-[15px] font-medium text-ink-2 hover:bg-paper"
          >
            Skip for now
          </Link>
        </div>
      </MobileStickyBar>
    </div>
  );
}

function ResolutionContactButtons({
  phone,
  email,
  disabled,
  onAdd,
}: {
  phone: string | null;
  email: string | null;
  disabled: boolean;
  onAdd: (kind: ResolutionContactKind) => void;
}) {
  if (!phone && !email) {
    return (
      <p className="text-[13px] text-ink-3">
        No resolution phone or email is saved. An owner can set one in Settings, then add it to this reply.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={disabled || !phone}
        onClick={() => onAdd("phone")}
        className="inline-flex h-12 items-center rounded-md border border-line bg-white px-3.5 text-[15px] text-ink disabled:opacity-50"
      >
        Add phone
      </button>
      <button
        type="button"
        disabled={disabled || !email}
        onClick={() => onAdd("email")}
        className="inline-flex h-12 items-center rounded-md border border-line bg-white px-3.5 text-[15px] text-ink disabled:opacity-50"
      >
        Add email
      </button>
      <button
        type="button"
        disabled={disabled || !phone || !email}
        onClick={() => onAdd("both")}
        className="inline-flex h-12 items-center rounded-md border border-line bg-white px-3.5 text-[15px] text-ink disabled:opacity-50"
      >
        Add both
      </button>
    </div>
  );
}
