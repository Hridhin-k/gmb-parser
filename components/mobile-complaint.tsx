"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, ExternalLink, RotateCcw, Sparkles } from "lucide-react";
import { SpeakButton } from "@/components/mobile-speech";
import { MobileReviewQuote, MobileStickyBar, OFFLINE_MESSAGE } from "@/components/mobile-shared";
import { StarRating } from "@/components/star-rating";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { RESOLUTION_ACTIONS, type ResolutionCode } from "@/lib/escalations";
import {
  insertResolutionContact,
  resolutionContactSentence,
  type ResolutionContactKind,
} from "@/lib/resolution-contact";
import { REPLY_LANGUAGES, type ReplyLanguage } from "@/lib/reply-adjustments";
import { checkReplyGuardrails } from "@/lib/reply-guardrails";
import type { MobileComplaint } from "@/lib/services/mobile-work";
import { useServerRefresh } from "@/hooks/use-server-refresh";
import { cn } from "@/lib/utils";

async function errorText(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || "That did not save.";
}

export function MobileComplaintView({ data, aiOnly = false }: { data: MobileComplaint; aiOnly?: boolean }) {
  const router = useRouter();
  const { refresh } = useServerRefresh();
  const card = data.card;
  const [note, setNote] = useState("");
  const [content, setContent] = useState(card?.replyContent ?? "");
  const [replyId, setReplyId] = useState(card?.replyId ?? null);
  const [language, setLanguage] = useState<ReplyLanguage>("en");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const violations = checkReplyGuardrails(content).map((item) => item.message);
  const chosen = RESOLUTION_ACTIONS.find((action) => action.id === card?.resolutionCode);
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);

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

  async function saveNote() {
    if (!card || !note.trim()) return;
    setPending("note");
    setError(null);
    const response = await fetch(`/api/reviews/${card.reviewId}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "note", body: note.trim() }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      setPending(null);
      return;
    }
    setNote("");
    setNotice("Note saved. It is not shown to the customer.");
    setPending(null);
    router.refresh();
  }

  async function generate() {
    if (!card) return;
    setPending("generate");
    setError(null);
    const response = await fetch(`/api/reviews/${card.reviewId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, replaceEdited: true }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      setPending(null);
      return;
    }
    const payload = (await response.json()) as { replyId?: string; content?: string };
    if (payload.content) setContent(payload.content);
    if (payload.replyId) setReplyId(payload.replyId);
    setNotice("Draft is ready. Read it before you send it on.");
    setPending(null);
    refresh();
  }

  async function nextStep(code: ResolutionCode) {
    if (!card) return;
    setPending(code);
    setError(null);
    const response = await fetch(`/api/escalations/${card.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "next", code }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      setPending(null);
      return;
    }
    setNotice("Next step recorded. It does not mean the call, replacement, or visit happened.");
    setPending(null);
    router.refresh();
  }

  async function passRegional() {
    if (!card) return;
    setPending("regional");
    setError(null);
    const response = await fetch(`/api/escalations/${card.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "level", level: "regional" }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      setPending(null);
      return;
    }
    setNotice("Passed to a regional manager. The escalation stays open.");
    setPending(null);
    router.refresh();
  }

  async function sendForApproval() {
    if (!card || !content.trim()) {
      setError(aiOnly ? "Generate an AI reply before sending it for approval." : "Write a reply before sending it for approval.");
      return;
    }
    setPending("submit");
    setError(null);
    let id = replyId;
    if (!aiOnly) {
      const saved = await fetch(`/api/reviews/${card.reviewId}/reply`, {
        method: replyId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replyId ? { replyId, content } : { content }),
      });
      if (!saved.ok) {
        setError(await errorText(saved));
        setPending(null);
        return;
      }
      const payload = (await saved.json()) as { id?: string };
      id = payload.id ?? replyId;
      if (!id) {
        setError("The draft was not saved.");
        setPending(null);
        return;
      }
      setReplyId(id);
    }
    if (!id) {
      setError("Generate an AI reply before sending it for approval.");
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

  if (!card) {
    return (
      <div className="space-y-4 text-[15px]">
        <h1 className="text-xl font-semibold text-ink">Cases</h1>
        {data.missingId ? (
          <Banner tone="warn">That escalation is not in this view. It may be resolved or outside the current scope.</Banner>
        ) : null}
        <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-white px-5 py-10 text-center" role="status">
          <CheckCircle2 className="size-8 text-ok" strokeWidth={1.5} aria-hidden />
          <p className="text-[15px] font-semibold text-ink">No open escalations in this view</p>
          <p className="text-[13px] text-ink-3">New complaints that match the rules appear here.</p>
        </div>
      </div>
    );
  }

  const busy = pending !== null;
  const atTop = card.level === "regional" || card.level === "leadership";

  return (
    <div className="space-y-3 text-[15px]">
      {data.missingId ? (
        <Banner tone="warn">That escalation is not in this view. Showing the next open case instead.</Banner>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-ink">Cases</h1>
          <span className="text-[13px] tabular-nums text-ink-3">
            {card.position} of {card.total}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={card.overdue ? "bad" : "default"}>{card.slaLabel}</Badge>
          <Badge variant={card.level === "leadership" ? "bad" : card.level === "regional" ? "warn" : "default"}>
            {card.levelLabel}
          </Badge>
          {card.theme ? <Badge variant="outline">{card.theme}</Badge> : null}
        </div>
        <p className="text-[13px] text-ink-3">
          {card.locationName} · {card.assigneeLabel}
        </p>
      </div>

      <article className="space-y-3 rounded-lg border border-line bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
          <StarRating rating={card.starRating} />
          <span className="font-semibold text-ink">{card.reviewerName}</span>
          {card.when ? <span>· {card.when}</span> : null}
        </div>
        {card.sameNameCount > 1 ? (
          <p className="text-[13px] text-ink-3">{card.sameNameCount} stored reviews use this display name.</p>
        ) : null}
        <MobileReviewQuote original={card.original} translation={card.translation} />
        {card.photosStored ? null : <p className="text-xs text-ink-3">Photos are not stored on this server.</p>}
        <Link
          href={`/escalations/${card.id}`}
          className="inline-flex h-12 items-center gap-1.5 text-[15px] font-medium text-brand"
        >
          Open full case <ExternalLink className="size-4" aria-hidden />
        </Link>
      </article>

      <section className="space-y-3 rounded-lg border border-line bg-white p-3.5" aria-labelledby="m-notes">
        <div>
          <h2 id="m-notes" className="text-[15px] font-semibold text-ink">
            Internal notes
          </h2>
          <p className="text-[13px] text-ink-3">What happened. Not shown to the customer.</p>
        </div>
        {card.escalationNote || card.notes.length > 0 ? (
          <ol className="space-y-2">
            {card.escalationNote ? (
              <li className="rounded-md bg-paper px-3 py-2 text-[15px] text-ink-2">{card.escalationNote}</li>
            ) : null}
            {card.notes.map((item) => (
              <li key={item.id} className="rounded-md bg-paper px-3 py-2 text-[15px] text-ink-2">
                {item.body}
                {item.when ? <span className="mt-1 block text-xs text-ink-3">{item.when}</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-ink-3">No notes yet.</p>
        )}
        {card.canDraft ? (
          <div className="space-y-2">
            <label htmlFor="incident-note" className="sr-only">
              Internal note
            </label>
            <textarea
              id="incident-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="Add a note…"
              className="block w-full resize-y rounded-md border border-line px-3 py-3 text-[15px] leading-6 text-ink placeholder:text-stone"
            />
            <div className="flex flex-wrap gap-2">
              <SpeakButton onText={(text) => setNote((current) => (current ? `${current} ${text}` : text))} />
              <Button type="button" variant="outline" className="h-12 px-4 text-[15px]" loading={pending === "note"} disabled={!note.trim() || busy} onClick={guarded(saveNote)}>
                Save note
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-white p-3.5" aria-labelledby="m-reply">
        <div>
          <h2 id="m-reply" className="text-[15px] font-semibold text-ink">
            Public reply
          </h2>
          <p className="text-[13px] text-ink-3">
            {aiOnly
              ? "The reply is written by AI. A higher role approves it, and then you can publish it from the inbox."
              : "A person who can approve 1–3 star replies has to approve this before it can be posted."}
          </p>
        </div>
        <div className={cn("overflow-hidden rounded-lg border", content.trim() ? "border-ai-line bg-[#fbf9ff]" : "border-line bg-white")}>
          {content.trim() ? (
            <div className="flex items-center gap-2 border-b border-ai-line px-3 py-2">
              <Badge variant="ai">Draft</Badge>
              <span className="flex-1" />
              <span className="text-xs tabular-nums text-ink-3">{content.length} chars</span>
            </div>
          ) : null}
          <label htmlFor="public-reply" className="sr-only">
            Public reply
          </label>
          <textarea
            id="public-reply"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={!card.canDraft || busy}
            readOnly={aiOnly}
            rows={5}
            placeholder={aiOnly ? "Generate an AI reply to fill this in." : "Write the public reply…"}
            className="block w-full resize-y border-0 bg-transparent px-3 py-3 text-[15px] leading-6 text-ink outline-none placeholder:text-stone"
          />
        </div>
        <p
          className={cn(
            "text-[13px]",
            content.trim().length === 0 ? "text-ink-3" : violations.length === 0 ? "text-ok" : "text-warn"
          )}
        >
          {content.trim().length === 0 ? "No reply yet." : violations.length === 0 ? "The reply checks passed." : violations[0]}
        </p>
        {aiOnly ? null : (
          <ResolutionContactButtons
            phone={data.resolutionPhone}
            email={data.resolutionEmail}
            disabled={!card.canDraft || busy}
            onAdd={(kind) => {
              const sentence = resolutionContactSentence(kind, {
                phone: data.resolutionPhone,
                email: data.resolutionEmail,
              });
              if (!sentence) return;
              setContent((current) => insertResolutionContact(current, sentence));
            }}
          />
        )}
        <label htmlFor="complaint-language" className="block text-[13px] font-medium text-ink-2">
          Reply language
          <select
            id="complaint-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value as ReplyLanguage)}
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
        <Button type="button" variant="ai" className="h-12 w-full text-[15px]" loading={pending === "generate"} disabled={busy} onClick={guarded(generate)}>
          <Sparkles aria-hidden />
          {content.trim() ? "Regenerate AI reply" : "Generate AI reply"}
        </Button>
      </section>

      {card.canDraft ? (
        <section className="space-y-2 rounded-lg border border-line bg-white p-3.5" aria-labelledby="m-next">
          <h2 id="m-next" className="text-[15px] font-semibold text-ink">
            Next step
          </h2>
          <div className="flex flex-col gap-2" role="group" aria-labelledby="m-next">
            {RESOLUTION_ACTIONS.map((action) => {
              const selected = card.resolutionCode === action.id;
              return (
                <button
                  key={action.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={guarded(() => nextStep(action.id))}
                  className={cn(
                    "flex min-h-12 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[15px] disabled:opacity-60",
                    selected ? "border-brand bg-brand-tint font-medium text-brand" : "border-line bg-white text-ink"
                  )}
                >
                  {action.label}
                  {selected ? <CheckCircle2 className="size-4 shrink-0" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          <p className="text-[13px] text-ink-3">
            {chosen?.detail ?? "Choosing one records the next step. It does not mean it happened, and the escalation stays open."}
          </p>
        </section>
      ) : null}

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
        {card.canDraft ? (
          <Button type="button" className="h-12 w-full text-[15px]" loading={pending === "submit"} disabled={busy} onClick={guarded(sendForApproval)}>
            Send for approval
          </Button>
        ) : null}
        {card.canPassRegional ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full text-[15px]"
            loading={pending === "regional"}
            disabled={atTop || busy}
            onClick={guarded(passRegional)}
          >
            {atTop ? `Already at ${card.levelLabel.toLowerCase()}` : "Pass to regional"}
          </Button>
        ) : (
          <p className="text-center text-xs text-ink-3">
            Passing this to a regional manager needs approval permission for 1–3 star reviews.
          </p>
        )}
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
