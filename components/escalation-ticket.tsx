"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { roleLabel } from "@/lib/access";
import {
  ESCALATION_LEVELS,
  RESOLUTION_ACTIONS,
  escalationEventLabel,
  escalationStatusLabel,
  ticketKey,
} from "@/lib/escalations";
import {
  insertResolutionContact,
  resolutionContactSentence,
  type ResolutionContact,
  type ResolutionContactKind,
} from "@/lib/resolution-contact";
import { themeLabel } from "@/lib/review-inbox";
import type { EscalationQueueItem } from "@/lib/services/escalations";

interface Member {
  userId: string;
  email: string;
  role: string;
  scopeLabel: string;
}

export function EscalationTicket({
  item,
  contact,
  members,
  assignees,
  canManage,
  canReassign,
}: {
  item: EscalationQueueItem & { remaining: string | null; overdue: string | null; dueLabel: string };
  contact: ResolutionContact;
  members: Member[];
  assignees: string[];
  canManage: boolean;
  canReassign: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [comment, setComment] = useState("");
  const name = (userId: string | null) => {
    if (!userId) return "nobody";
    return members.find((member) => member.userId === userId)?.email ?? "a former member";
  };
  const open = item.status !== "resolved";

  async function send(body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/escalations/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error ?? "That change could not be saved.");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-4">
      <Link href="/escalations" className="text-sm text-ink underline">
        Escalations
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate">{ticketKey(item.ticketNo)}</p>
          <h1 className="mt-1 text-xl font-medium text-ink">
            {item.reviewerName} · {item.starRating}★
          </h1>
          <p className="mt-1 text-sm text-slate">
            {item.locationName}
            {item.groupName ? ` · ${item.groupName}` : ""}
            {item.clientName ? ` · ${item.clientName}` : ""}
            {themeLabel(item.theme) ? ` · ${themeLabel(item.theme)}` : ""}
          </p>
        </div>
        <p className="rounded-full bg-paper px-3 py-1 text-sm text-ink">{escalationStatusLabel(item.status)}</p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <section className="rounded-xl bg-white p-4 shadow-card">
            <h2 className="text-sm font-medium text-ink">Review</h2>
            {item.comment ? <p className="mt-2 text-sm leading-relaxed text-ink">{item.comment}</p> : <p className="mt-2 text-sm text-slate">Rating only. No written comment.</p>}
            <p className="mt-3 text-xs text-slate">
              Triggers: {item.triggerReasons.map((reason) => (reason === "recorded" ? "already open" : reason)).join(", ")}.
              A public reply does not close this case.
            </p>
          </section>

          {open ? (
            <section className="rounded-xl bg-white p-4 shadow-card">
              <ResolutionReply
                reviewId={item.reviewId}
                replyId={item.replyId}
                replyStatus={item.replyStatus}
                initialContent={item.replyContent}
                contact={contact}
              />
            </section>
          ) : (
            <section className="rounded-xl bg-white p-4 shadow-card">
              <h2 className="text-sm font-medium text-ink">Resolution</h2>
              <p className="mt-2 text-sm text-slate">
                {RESOLUTION_ACTIONS.find((action) => action.id === item.resolutionCode)?.detail ??
                  "Resolved with a recorded next step."}
                {item.resolutionNote ? ` Note: ${item.resolutionNote}` : ""}
              </p>
            </section>
          )}

          <section className="rounded-xl bg-white p-4 shadow-card">
            <h2 className="text-sm font-medium text-ink">Activity</h2>
            {item.events.length === 0 ? (
              <p className="mt-2 text-sm text-slate">No comments or status changes yet.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {item.events.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`} className="border-t border-silver pt-3 first:border-t-0 first:pt-0">
                    <p className="text-xs text-slate">
                      {name(event.actorId ?? null)} · {new Date(event.createdAt).toLocaleString("en-US")}
                    </p>
                    {event.action === "comment" && event.body ? (
                      <p className="mt-1 text-sm text-ink">{event.body}</p>
                    ) : (
                      <p className="mt-1 text-sm text-slate">
                        {escalationEventLabel(event.action, event.metadata as Record<string, unknown>, name)}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <form
              className="mt-4 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!comment.trim()) return;
                void send({ action: "comment", body: comment.trim() }).then((ok) => {
                  if (ok) setComment("");
                });
              }}
            >
              <label className="block text-xs text-slate">
                Comment
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  disabled={pending}
                  className="mt-1 block w-full resize-y rounded-md border border-line px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <button
                type="submit"
                disabled={pending || !comment.trim()}
                className="rounded-md bg-ink px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {pending ? "Saving…" : "Add comment"}
              </button>
              <p className="text-xs text-slate">Comments stay in GRM. They are not posted to Google.</p>
            </form>
          </section>
        </div>

        <aside className="space-y-3 rounded-xl bg-white p-4 shadow-card">
          <h2 className="text-sm font-medium text-ink">Details</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-slate">Status</dt>
              <dd className="text-ink">{escalationStatusLabel(item.status)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Assignee</dt>
              <dd className="text-ink">{name(item.assignedTo)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Responsible manager</dt>
              <dd className="text-ink">{name(item.responsibleUserId)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Due</dt>
              <dd className="text-ink">
                {item.dueLabel}
                {item.remaining ? ` · ${item.remaining} remaining` : ""}
                {item.overdue ? ` · ${item.overdue} overdue` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Level</dt>
              <dd className="text-ink">{ESCALATION_LEVELS.find((level) => level.id === item.level)?.label ?? item.level}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Reply</dt>
              <dd className="text-ink">{item.replyStatus}</dd>
            </div>
          </dl>
          {item.status === "needs_human" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => void send({ action: "start" })}
              className="rounded-md bg-ink px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Start
            </button>
          ) : null}
          {open && canManage ? (
            <label className="block text-xs text-slate">
              Level
              <select
                className="mt-1 block w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                value={item.level}
                disabled={pending}
                onChange={(event) => void send({ action: "level", level: event.target.value })}
              >
                {ESCALATION_LEVELS.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {open && canReassign ? (
            <AssignBox
              members={members.filter((member) => assignees.includes(member.userId))}
              assignedTo={item.assignedTo}
              disabled={pending}
              onAssign={(userId, reason) =>
                void send({ action: "assign", userId, reason, expectedUpdatedAt: item.updatedAt })
              }
            />
          ) : null}
          {open ? (
            <ResolveBox disabled={pending} onResolve={(code, note) => void send({ action: "resolve", code, note })} />
          ) : null}
          <Link href={`/reviews?q=${encodeURIComponent(item.reviewerName)}`} className="block text-sm text-ink underline">
            Open in inbox
          </Link>
        </aside>
      </div>
    </div>
  );
}

function AssignBox({
  members,
  assignedTo,
  disabled,
  onAssign,
}: {
  members: Member[];
  assignedTo: string | null;
  disabled: boolean;
  onAssign: (userId: string, reason: string) => void;
}) {
  const [userId, setUserId] = useState(assignedTo ?? "");
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!userId || reason.trim().length < 3) return;
        onAssign(userId, reason.trim());
        setReason("");
      }}
    >
      <label className="block text-xs text-slate">
        Assignee
        <select
          className="mt-1 block w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
          value={userId}
          disabled={disabled}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">Choose…</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.email} · {roleLabel(member.role)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-slate">
        Reason
        <input
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <button
        type="submit"
        disabled={disabled || !userId || reason.trim().length < 3}
        className="rounded-md border border-line px-3 py-1.5 text-sm text-ink disabled:opacity-40"
      >
        Assign
      </button>
    </form>
  );
}

function ResolveBox({
  disabled,
  onResolve,
}: {
  disabled: boolean;
  onResolve: (code: string, note: string) => void;
}) {
  const [code, setCode] = useState<(typeof RESOLUTION_ACTIONS)[number]["id"]>(RESOLUTION_ACTIONS[0].id);
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        onResolve(code, note);
        setNote("");
      }}
    >
      <label className="block text-xs text-slate">
        Resolve
        <select
          className="mt-1 block w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
          value={code}
          onChange={(event) => setCode(event.target.value as typeof code)}
        >
          {RESOLUTION_ACTIONS.map((action) => (
            <option key={action.id} value={action.id}>
              {action.label}
            </option>
          ))}
        </select>
      </label>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        placeholder="Note"
        className="block w-full rounded-md border border-line px-2 py-1.5 text-sm"
      />
      <button type="submit" disabled={disabled} className="rounded-md bg-ink px-3 py-1.5 text-sm text-white">
        Resolve
      </button>
      <p className="text-xs text-slate">{RESOLUTION_ACTIONS.find((action) => action.id === code)?.detail}</p>
    </form>
  );
}

function ResolutionReply({
  reviewId,
  replyId,
  replyStatus,
  initialContent,
  contact,
}: {
  reviewId: string;
  replyId: string | null;
  replyStatus: string;
  initialContent: string;
  contact: ResolutionContact;
}) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [savedId, setSavedId] = useState(replyId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = replyStatus === "published" || replyStatus === "pending_publish";

  function add(kind: ResolutionContactKind) {
    const sentence = resolutionContactSentence(kind, contact);
    if (!sentence) return;
    setContent((current) => insertResolutionContact(current, sentence));
    setError(null);
  }

  async function save() {
    const text = content.trim();
    if (!text) {
      setError("Write a reply before saving it.");
      return;
    }
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/reviews/${reviewId}/reply`, {
      method: savedId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(savedId ? { replyId: savedId, content: text } : { content: text }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
    setSaving(false);
    if (!response.ok) {
      setError(payload.error ?? "That reply could not be saved.");
      return;
    }
    if (payload.id) setSavedId(payload.id);
    toast.success("Reply saved. It is not on Google yet.");
    router.refresh();
  }

  if (locked) {
    return (
      <p className="text-sm text-slate">
        {replyStatus === "published"
          ? "A public reply is already on Google."
          : "This reply is being published."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-ink">Public reply</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!contact.phone || saving} onClick={() => add("phone")} className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50">
          Add phone
        </button>
        <button type="button" disabled={!contact.email || saving} onClick={() => add("email")} className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50">
          Add email
        </button>
        <button type="button" disabled={!contact.phone || !contact.email || saving} onClick={() => add("both")} className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50">
          Add both
        </button>
      </div>
      {!contact.phone && !contact.email ? (
        <p className="text-xs text-slate">
          <a href="/settings?section=sla" className="text-ink underline">
            Set a resolution phone or email in Settings
          </a>{" "}
          before adding it here.
        </p>
      ) : null}
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={4}
        maxLength={4000}
        disabled={saving}
        aria-label="Public reply"
        className="block w-full resize-y rounded-md border border-line px-2 py-1.5 text-sm text-ink"
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button type="button" disabled={saving || !content.trim()} onClick={() => void save()} className="rounded-md bg-ink px-3 py-1.5 text-sm text-white disabled:opacity-50">
        {saving ? "Saving…" : "Save reply"}
      </button>
    </div>
  );
}
