"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SpeakButton } from "@/components/mobile-speech";
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
  const dirty = card ? content !== card.content : false;
  const violations = checkReplyGuardrails(content).map((item) => item.message);
  const publishable = card?.publishableIds.length ?? 0;

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
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      succeeded?: number;
      failed?: number;
    };
    if (!response.ok) {
      setError(payload.error || "Those replies were not posted.");
      setPending(null);
      return;
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-medium text-ink">Approve replies</h1>
        <p className="mt-1 text-sm text-slate">
          {card
            ? `${card.locationName} · ${card.position} of ${card.total}${card.skipped > 0 ? ` · ${card.skipped} skipped, still drafts` : ""}`
            : "No replies are waiting for a decision."}
        </p>
      </div>

      {!card ? (
        <p className="text-sm text-slate">
          Drafts you skip stay in the queue.
          {data.skippedIds.length > 0 ? (
            <>
              {" "}
              <Link href={data.clearSkipHref} className="text-ink underline">
                Show skipped replies
              </Link>
            </>
          ) : null}
        </p>
      ) : (
        <article className="space-y-4 rounded-2xl border border-silver bg-white p-4">
          {publishable > 0 && card.canPublish ? (
            confirmPost ? (
              <div className="space-y-2">
                <p className="text-sm text-graphite">
                  Post {publishable} repl{publishable === 1 ? "y" : "ies"} of 4 or 5 stars to Google. Replies that fail a
                  check are left out.
                </p>
                <div className="flex gap-2">
                  <Button type="button" className="bg-action-blue text-white hover:bg-action-blue/90" loading={pending === "all"} onClick={postReady}>
                    Post to Google
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirmPost(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => setConfirmPost(true)}>
                Approve and post {publishable} of 4–5 stars
              </Button>
            )
          ) : null}

          <div>
            <p className="text-sm text-ink">
              {card.starRating} of 5 stars · {card.reviewerName}
              {card.when ? ` · ${card.when}` : ""}
            </p>
            {card.sameNameCount > 1 ? (
              <p className="mt-1 text-sm text-slate">
                {card.sameNameCount} stored reviews use this display name.
              </p>
            ) : null}
          </div>

          {card.original ? (
            <div>
              <h2 className="text-sm font-medium text-ink">{card.translation ? "Original" : "Review"}</h2>
              <p className="mt-1 whitespace-pre-wrap break-words text-base leading-6 text-graphite">{card.original}</p>
            </div>
          ) : (
            <p className="text-sm text-slate">This review has no written comment.</p>
          )}
          {card.translation ? (
            <div>
              <h2 className="text-sm font-medium text-ink">English translation</h2>
              <p className="mt-1 whitespace-pre-wrap break-words text-base leading-6 text-graphite">{card.translation}</p>
            </div>
          ) : null}

          <div>
            <label htmlFor="mobile-reply" className="text-sm font-medium text-ink">
              Suggested reply
            </label>
            <textarea
              id="mobile-reply"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={!card.canDraft || pending !== null}
              rows={5}
              className="mt-2 w-full resize-y rounded-xl border border-silver bg-white px-3 py-3 text-base leading-6 text-ink"
            />
            <ResolutionContactButtons
              phone={data.resolutionPhone}
              email={data.resolutionEmail}
              disabled={!card.canDraft || pending !== null}
              onAdd={(kind) => {
                const sentence = resolutionContactSentence(kind, {
                  phone: data.resolutionPhone,
                  email: data.resolutionEmail,
                });
                if (!sentence) return;
                setContent((current) => insertResolutionContact(current, sentence));
              }}
            />
            <p className="mt-2 text-sm text-slate">
              {content.trim().length === 0
                ? "No reply yet."
                : violations.length === 0
                  ? "The reply checks passed."
                  : violations[0]}
            </p>
          </div>

          {card.canDraft ? (
            <div className="space-y-3">
              <label className="block text-sm text-slate" htmlFor="reply-language">
                Reply language
                <select
                  id="reply-language"
                  value={language}
                  onChange={(event) => {
                    const next = event.target.value as ReplyLanguage;
                    setLanguage(next);
                    void generate({ language: next });
                  }}
                  className="mt-1 h-12 w-full rounded-lg border border-silver bg-white px-3 text-base text-ink"
                >
                  {REPLY_LANGUAGES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="h-11 rounded-full border border-silver px-4 text-sm text-ink" disabled={pending !== null} onClick={() => generate({ adjustment: "regenerate" })}>
                  Try again
                </button>
                <button type="button" className="h-11 rounded-full border border-silver px-4 text-sm text-ink" disabled={pending !== null} onClick={() => generate({ adjustment: "shorter" })}>
                  Shorter
                </button>
                <button type="button" className="h-11 rounded-full border border-silver px-4 text-sm text-ink" disabled={pending !== null} onClick={() => generate({ adjustment: "warmer" })}>
                  Warmer
                </button>
                <SpeakButton onText={(text) => setContent((current) => (current ? `${current} ${text}` : text))} disabled={pending !== null} />
              </div>
              <p className="text-sm text-slate">Speak appears when this browser can capture speech. Typing always works.</p>
            </div>
          ) : (
            <p className="text-sm text-slate">You can read this reply. You cannot change it.</p>
          )}

          {error ? (
            <p role="alert" className="text-sm text-ink">
              {error}
            </p>
          ) : null}
          {notice ? <p className="text-sm text-ink">{notice}</p> : null}

          <div className="space-y-2">
            {card.canDraft ? (
              card.openEscalationId ? (
                <Link href={mobileHref("/m/escalations", { client: data.clientId, group: data.groupId, location: data.locationId, id: card.openEscalationId })} className="flex h-12 items-center justify-center rounded-full border border-silver text-sm text-ink">
                  On the escalation list
                </Link>
              ) : (
                <Button type="button" variant="outline" className="w-full" loading={pending === "escalate"} onClick={needsManager}>
                  Needs a manager
                </Button>
              )
            ) : null}
            {card.canPublish ? (
              <Button type="button" className="w-full bg-action-blue text-white hover:bg-action-blue/90" loading={pending === "publish"} onClick={approveAndPost}>
                Approve and post
              </Button>
            ) : card.canDraft ? (
              <Button type="button" className="w-full" loading={pending === "submit"} onClick={sendForApproval}>
                Send for approval
              </Button>
            ) : null}
            <Link href={skipHref} className="flex h-12 items-center justify-center rounded-full text-sm text-slate">
              Skip for now
            </Link>
          </div>
        </article>
      )}
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
      <p className="mt-2 text-sm text-slate">
        No resolution phone or email is saved. An owner can set one in Settings, then add it to this reply.
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        disabled={disabled || !phone}
        onClick={() => onAdd("phone")}
        className="min-h-11 rounded-xl border border-silver px-3 text-sm text-ink disabled:opacity-50"
      >
        Add phone
      </button>
      <button
        type="button"
        disabled={disabled || !email}
        onClick={() => onAdd("email")}
        className="min-h-11 rounded-xl border border-silver px-3 text-sm text-ink disabled:opacity-50"
      >
        Add email
      </button>
      <button
        type="button"
        disabled={disabled || !phone || !email}
        onClick={() => onAdd("both")}
        className="min-h-11 rounded-xl border border-silver px-3 text-sm text-ink disabled:opacity-50"
      >
        Add both
      </button>
    </div>
  );
}
