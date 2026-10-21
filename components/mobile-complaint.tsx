"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SpeakButton } from "@/components/mobile-speech";
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

async function errorText(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || "That did not save.";
}

export function MobileComplaintView({ data }: { data: MobileComplaint }) {
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
      setError("Write a reply before sending it for approval.");
      return;
    }
    setPending("submit");
    setError(null);
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
    const id = payload.id ?? replyId;
    if (!id) {
      setError("The draft was not saved.");
      setPending(null);
      return;
    }
    setReplyId(id);
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-medium text-ink">Needs your reply</h1>
        <p className="mt-1 text-sm text-slate">
          {card ? `${card.position} of ${card.total}` : "No open escalations in this view."}
        </p>
      </div>

      {data.missingId ? (
        <p className="text-sm text-slate">That escalation is not in this view.</p>
      ) : null}

      {!card ? null : (
        <article className="space-y-4 rounded-2xl border border-silver bg-white p-4">
          <div>
            <p className={`text-base font-medium ${card.overdue ? "text-ink" : "text-ink"}`}>{card.slaLabel}</p>
            <p className="mt-1 text-sm text-slate">
              {card.locationName} · {card.assigneeLabel} · {card.levelLabel}
            </p>
          </div>

          <div>
            <p className="text-sm text-ink">
              {card.starRating} of 5 stars · {card.reviewerName}
              {card.when ? ` · ${card.when}` : ""}
            </p>
            {card.theme ? <p className="mt-1 text-sm text-slate">{card.theme}</p> : null}
            {card.sameNameCount > 1 ? (
              <p className="mt-1 text-sm text-slate">{card.sameNameCount} stored reviews use this display name.</p>
            ) : null}
          </div>

          {card.original ? (
            <p className="whitespace-pre-wrap break-words text-base leading-6 text-graphite">{card.original}</p>
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
            <h2 className="text-sm font-medium text-ink">Internal notes</h2>
            <p className="mt-1 text-sm text-slate">What happened. This is not shown to the customer.</p>
            {card.escalationNote ? <p className="mt-2 text-sm text-graphite">{card.escalationNote}</p> : null}
            {card.notes.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {card.notes.map((item) => (
                  <li key={item.id} className="rounded-xl bg-paper px-3 py-2 text-sm text-graphite">
                    {item.body}
                    {item.when ? <span className="mt-1 block text-xs text-slate">{item.when}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {card.canDraft ? (
              <div className="mt-3 space-y-2">
                <label htmlFor="incident-note" className="sr-only">
                  Internal note
                </label>
                <textarea
                  id="incident-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-xl border border-silver px-3 py-3 text-base leading-6 text-ink"
                />
                <div className="flex flex-wrap gap-2">
                  <SpeakButton onText={(text) => setNote((current) => (current ? `${current} ${text}` : text))} />
                  <Button type="button" variant="outline" loading={pending === "note"} disabled={!note.trim()} onClick={saveNote}>
                    Save note
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {card.photosStored ? null : (
            <p className="text-sm text-slate">Photos are not stored on this server.</p>
          )}

          <div>
            <label htmlFor="public-reply" className="text-sm font-medium text-ink">
              Public reply
            </label>
            <p className="mt-1 text-sm text-slate">A person who can approve 1–3 star replies has to approve this before it can be posted.</p>
            <textarea
              id="public-reply"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={!card.canDraft || pending !== null}
              rows={5}
              className="mt-2 w-full resize-y rounded-xl border border-silver px-3 py-3 text-base leading-6 text-ink"
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
              {content.trim().length === 0 ? "No reply yet." : violations.length === 0 ? "The reply checks passed." : violations[0]}
            </p>
            {card.canDraft ? (
              <div className="mt-3 space-y-2">
                <label htmlFor="complaint-language" className="block text-sm text-slate">
                  Reply language
                  <select
                    id="complaint-language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value as ReplyLanguage)}
                    className="mt-1 h-12 w-full rounded-lg border border-silver bg-white px-3 text-base text-ink"
                  >
                    {REPLY_LANGUAGES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="button" variant="outline" loading={pending === "generate"} onClick={generate}>
                  Write reply for me
                </Button>
              </div>
            ) : null}
          </div>

          {card.canDraft ? (
            <div>
              <h2 className="text-sm font-medium text-ink">Suggested next step</h2>
              <div className="mt-2 flex flex-col gap-2">
                {RESOLUTION_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={pending !== null}
                    onClick={() => nextStep(action.id)}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm ${card.resolutionCode === action.id ? "border-ink bg-paper text-ink" : "border-silver text-ink"}`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-slate">{chosen?.detail ?? "Choosing one records the next step. It does not mean it happened, and the escalation stays open."}</p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-ink">
              {error}
            </p>
          ) : null}
          {notice ? <p className="text-sm text-ink">{notice}</p> : null}

          <div className="space-y-2">
            {card.canPassRegional ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                loading={pending === "regional"}
                disabled={card.level === "regional" || card.level === "leadership"}
                onClick={passRegional}
              >
                {card.level === "regional" || card.level === "leadership"
                  ? `Already at ${card.levelLabel.toLowerCase()}`
                  : "Pass to regional"}
              </Button>
            ) : (
              <p className="text-sm text-slate">Passing this to a regional manager needs approval permission for 1–3 star reviews.</p>
            )}
            {card.canDraft ? (
              <Button type="button" className="w-full bg-action-blue text-white hover:bg-action-blue/90" loading={pending === "submit"} onClick={sendForApproval}>
                Send for approval
              </Button>
            ) : null}
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
