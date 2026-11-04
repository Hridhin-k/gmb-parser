"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { roleLabel } from "@/lib/access";
import {
  ESCALATION_LEVELS,
  FOLLOW_UP_OUTCOMES,
  escalationEventLabel,
} from "@/lib/escalations";
import {
  insertResolutionContact,
  resolutionContactSentence,
  type ResolutionContact,
  type ResolutionContactKind,
} from "@/lib/resolution-contact";
import { themeLabel } from "@/lib/review-inbox";
import type { EscalationQueueItem } from "@/lib/services/escalations";
import { cn } from "@/lib/utils";
import { DraftContactMenu } from "@/components/draft-contact-menu";
import type { ResolutionContactSelection } from "@/lib/resolution-contact";
import { savedReplyId } from "@/lib/ai-generation-client";

interface Member {
  userId: string;
  email: string;
  role: string;
  scopeLabel: string;
}

type TicketItem = EscalationQueueItem & { remaining: string | null; overdue: string | null; dueLabel: string };

const CARD = "rounded-lg border border-line bg-white";
const CARD_HEAD = "flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3";

const REPLY_STATUS: Record<string, { label: string; variant: "default" | "brand" | "info" | "ok" | "bad" }> = {
  none: { label: "No reply yet", variant: "default" },
  draft: { label: "Draft", variant: "default" },
  approved: { label: "Approved", variant: "brand" },
  pending_publish: { label: "Publishing", variant: "info" },
  published: { label: "Published", variant: "ok" },
  failed: { label: "Publish failed", variant: "bad" },
};

function replyBadge(status: string) {
  const meta = REPLY_STATUS[status] ?? { label: status, variant: "default" as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

const EVENT_DOT: Record<string, string> = {
  opened: "bg-bad",
  reopened: "bg-bad",
  overdue_noted: "bg-warn",
  reminder_recorded: "bg-warn",
  resolved: "bg-ok",
  assigned: "bg-brand",
  level_changed: "bg-brand",
  status_changed: "bg-brand",
  next_step: "bg-brand",
};

export function EscalationTicket({
  item,
  contact,
  members,
  assignees,
  canManage,
  canReassign,
  aiOnly = false,
}: {
  item: TicketItem;
  contact: ResolutionContact;
  members: Member[];
  assignees: string[];
  canManage: boolean;
  canReassign: boolean;
  aiOnly?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [comment, setComment] = useState("");
  const [showSystem, setShowSystem] = useState(true);
  const name = (userId: string | null) => {
    if (!userId) return "nobody";
    return members.find((member) => member.userId === userId)?.email ?? "a former member";
  };
  const open = item.status !== "resolved";
  const events = showSystem ? item.events : item.events.filter((event) => event.action === "comment");
  const resolution = FOLLOW_UP_OUTCOMES.find((action) => action.id === item.resolutionCode);

  async function send(body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/escalations/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response) {
      setPending(false);
      setError("No connection. Nothing was saved. Check your network and try again.");
      return false;
    }
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
      {error ? (
        <Banner tone="bad" title="Not saved.">
          {error}
        </Banner>
      ) : null}
      {item.status === "needs_human" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span>Nobody has started this follow-up yet.</span>
          <Button type="button" size="sm" variant="outline" loading={pending} onClick={() => void send({ action: "start" })}>
            Start follow-up
          </Button>
        </div>
      ) : null}
      {item.triggerReasons.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <span>Triggered by</span>
          {item.triggerReasons.map((reason) => (
            <Badge key={reason} variant="outline">
              {reason === "recorded" ? "already open" : reason.replace(/_/g, " ")}
            </Badge>
          ))}
          {themeLabel(item.theme) ? <span>· {themeLabel(item.theme)}</span> : null}
        </div>
      ) : null}
      <section className={CARD}>
        <ResolutionReply
          reviewId={item.reviewId}
          replyId={item.replyId}
          replyStatus={item.replyStatus}
          initialContent={item.replyContent}
          contact={contact}
          aiOnly={aiOnly}
        />
      </section>

      <section className={CARD}>
        <div className={CARD_HEAD}>
          <h2 className="text-sm font-semibold text-ink">Timeline and discussion</h2>
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <Checkbox checked={showSystem} onCheckedChange={(checked) => setShowSystem(checked === true)} />
            Show system events
          </label>
        </div>
        <div className="px-4 py-4">
          {events.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              {item.events.length === 0 ? "No comments or status changes yet." : "No comments yet."}
            </p>
          ) : (
            <ol className="relative space-y-3 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-line">
              {events.map((event, index) => {
                const when = new Date(event.createdAt).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                });
                const isComment = event.action === "comment" && event.body;
                return (
                  <li key={`${event.createdAt}-${index}`} className="relative flex gap-3 pl-0">
                    <span
                      aria-hidden
                      className={cn(
                        "relative z-[1] mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-white",
                        isComment ? "bg-ink-3" : (EVENT_DOT[event.action] ?? "bg-line-2")
                      )}
                    />
                    {isComment ? (
                      <div className="min-w-0 flex-1 rounded-md border border-line bg-white px-3 py-2">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-ink">{name(event.actorId ?? null)}</span>
                          <span className="text-ink-3">{when}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-[13px] text-ink-2">{event.body}</p>
                      </div>
                    ) : (
                      <p className="min-w-0 flex-1 text-[13px] text-ink-2">
                        {escalationEventLabel(event.action, event.metadata as Record<string, unknown>, name)}{" "}
                        <span className="text-xs text-ink-3">
                          · {name(event.actorId ?? null) === "nobody" ? "System" : name(event.actorId ?? null)} · {when}
                        </span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <form
          className="space-y-2 border-t border-line px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!comment.trim()) return;
            void send({ action: "comment", body: comment.trim() }).then((ok) => {
              if (ok) setComment("");
            });
          }}
        >
          <label htmlFor="case-comment" className="sr-only">
            Internal comment
          </label>
          <Textarea
            id="case-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={pending}
            placeholder="Add an internal comment…"
            className="resize-y"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-3">Internal only. Comments stay in GRM and are not posted to Google.</span>
            <Button type="submit" size="sm" loading={pending} disabled={!comment.trim()}>
              Comment
            </Button>
          </div>
        </form>
      </section>
      {open ? (
        <details className={cn(CARD, "space-y-3 p-4")}>
          <summary className="cursor-pointer text-sm font-medium text-ink">Team: change who handles this</summary>
          {canManage ? (
            <div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              <span aria-hidden>Level</span>
              <SelectField
                label="Level"
                value={item.level}
                disabled={pending}
                onValueChange={(level) => {
                  if (level !== item.level) void send({ action: "level", level });
                }}
                options={ESCALATION_LEVELS.map((level) => ({ value: level.id, label: level.label }))}
              />
            </div>
          ) : (
            <p className="text-xs text-ink-3">Changing the level needs approval permission for 1–3 star reviews.</p>
          )}
          {canReassign ? (
            <AssignBox
              members={members.filter((member) => assignees.includes(member.userId))}
              assignedTo={item.assignedTo}
              disabled={pending}
              onAssign={(userId, reason) =>
                void send({ action: "assign", userId, reason, expectedUpdatedAt: item.updatedAt })
              }
            />
          ) : (
            <p className="text-xs text-ink-3">Your role cannot reassign cases. Ask a manager to change the owner.</p>
          )}
        </details>
      ) : null}

      {open ? (
        <section id="resolve" className={cn(CARD, "scroll-mt-24 space-y-3 border-ok-line p-4")}>
          <h2 className="text-sm font-semibold text-ink">All taken care of?</h2>
          <ResolveBox disabled={pending} onResolve={(code, note) => void send({ action: "resolve", code, note })} />
        </section>
      ) : (
        <section className={cn(CARD, "space-y-2 border-ok-line bg-[#f8fcf9] p-4")}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Resolution</h2>
            <Badge variant="ok">Done</Badge>
          </div>
          {resolution ? <p className="text-[13px] font-medium text-ink">{resolution.label}</p> : null}
          <p className="text-[13px] text-ink-2">
            {resolution?.detail ?? "Resolved with a recorded next step."}
          </p>
          {item.resolutionNote ? (
            <p className="whitespace-pre-wrap break-words rounded-md bg-white px-3 py-2 text-[13px] text-ink-2">
              {item.resolutionNote}
            </p>
          ) : null}
          {item.resolvedAt ? (
            <p className="text-xs text-ink-3">
              Resolved {new Date(item.resolvedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          ) : null}
          <p className="text-xs text-ink-3">
            There is no manual reopen yet. The case reopens on its own if the reviewer changes the review.
          </p>
        </section>
      )}
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
      className="space-y-2 border-t border-line-2 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!userId || reason.trim().length < 3) return;
        onAssign(userId, reason.trim());
        setReason("");
      }}
    >
      <div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        <span aria-hidden>Owner</span>
        <SelectField
          label="Assignee"
          value={userId}
          disabled={disabled}
          placeholder="Choose…"
          onValueChange={setUserId}
          options={members.map((member) => ({
            value: member.userId,
            label: `${member.email} · ${roleLabel(member.role)}`,
          }))}
        />
      </div>
      {members.length === 0 ? (
        <p className="text-xs text-ink-3">Nobody with access to this location can receive the case.</p>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        Reason
        <Input
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why this person"
        />
      </label>
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={disabled || !userId || reason.trim().length < 3}
      >
        {assignedTo ? "Reassign" : "Assign"}
      </Button>
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
  const [code, setCode] = useState<(typeof FOLLOW_UP_OUTCOMES)[number]["id"]>(FOLLOW_UP_OUTCOMES[0].id);
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
      <div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        <span aria-hidden>What did you do?</span>
        <SelectField
          label="What did you do?"
          value={code}
          onValueChange={(value) => setCode(value as typeof code)}
          options={FOLLOW_UP_OUTCOMES.map((action) => ({ value: action.id, label: action.label }))}
        />
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        Summary
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="For example: Replied and helped with the refund (optional)"
        />
      </label>
      <Button type="submit" className="w-full" loading={disabled}>
        Mark as done
      </Button>
      <p className="text-xs leading-relaxed text-ink-3">{FOLLOW_UP_OUTCOMES.find((action) => action.id === code)?.detail}</p>
    </form>
  );
}

function ResolutionReply({
  reviewId,
  replyId,
  replyStatus,
  initialContent,
  contact,
  aiOnly,
}: {
  reviewId: string;
  replyId: string | null;
  replyStatus: string;
  initialContent: string;
  contact: ResolutionContact;
  aiOnly: boolean;
}) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [savedId, setSavedId] = useState(replyId);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || generating;
  const published = replyStatus === "published" && content === initialContent;

  function add(kind: ResolutionContactKind) {
    const sentence = resolutionContactSentence(kind, contact);
    if (!sentence) return;
    setContent((current) => insertResolutionContact(current, sentence));
    setGenerated(false);
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
    }).catch(() => null);
    if (!response) {
      setSaving(false);
      setError("No connection. The reply was not saved.");
      return;
    }
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

  async function generate(contactDetails?: ResolutionContactSelection) {
    setGenerating(true);
    setError(null);
    const response = await fetch(`/api/reviews/${reviewId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replaceEdited: true, contactDetails }),
    }).catch(() => null);
    if (!response) {
      setGenerating(false);
      setError("No connection. The reply was not generated.");
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      content?: string;
      replyId?: string;
      jobId?: string | null;
    };
    if (!response.ok) {
      setGenerating(false);
      setError(payload.error ?? "The reply could not be generated.");
      return;
    }
    try {
      setSavedId(await savedReplyId(payload));
    } catch (error) {
      setError(error instanceof Error ? error.message : "The draft has not finished saving.");
      setGenerating(false);
      return;
    }
    if (payload.content) setContent(payload.content);
    setGenerating(false);
    setGenerated(true);
    toast.success("AI reply is ready. It is not on Google yet.");
    router.refresh();
  }

  return (
    <div>
      <div className={CARD_HEAD}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">Public reply</h2>
          {replyBadge(replyStatus)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ai" loading={generating} disabled={busy} onClick={() => void generate()}>
            <Sparkles aria-hidden />
            {generating ? "Writing…" : content.trim() ? "Regenerate AI reply" : "Draft AI reply"}
          </Button>
          <DraftContactMenu contact={contact} disabled={busy} onDraft={(selection) => void generate(selection)} />
        </div>
      </div>
      <div className="space-y-3 p-4">
        {replyStatus === "published" ? (
          <p className="text-xs text-ink-3">A reply is already on Google. A new draft stays in GRM until you publish it.</p>
        ) : replyStatus === "pending_publish" ? (
          <p className="text-xs text-ink-3">This reply is being published.</p>
        ) : null}
        <div
          className={cn(
            "overflow-hidden rounded-md border",
            generated ? "border-ai-line bg-[#fbf9ff]" : published ? "border-ok-line bg-[#f8fcf9]" : "border-line bg-white"
          )}
        >
          {generated ? (
            <div className="flex items-center gap-2 border-b border-ai-line px-3 py-1.5">
              <Badge variant="ai">AI draft</Badge>
              <span className="text-xs text-ink-3">Read it before you save.</span>
            </div>
          ) : null}
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setGenerated(false);
            }}
            rows={5}
            maxLength={4000}
            disabled={busy}
            readOnly={aiOnly}
            aria-label="Public reply"
            placeholder={aiOnly ? "Draft an AI reply to fill this in." : "Write the public reply…"}
            className="block w-full resize-y border-0 bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-stone read-only:cursor-default"
          />
        </div>
        {aiOnly ? (
          <p className="text-xs text-ink-3">Your reply is written by AI. A higher role approves it before it can be published.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-3">Add contact:</span>
            <Button type="button" size="xs" variant="outline" disabled={!contact.phone || busy} onClick={() => add("phone")}>
              Phone
            </Button>
            <Button type="button" size="xs" variant="outline" disabled={!contact.email || busy} onClick={() => add("email")}>
              Email
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!contact.phone || !contact.email || busy}
              onClick={() => add("both")}
            >
              Both
            </Button>
            {!contact.phone && !contact.email ? (
              <span className="text-xs text-ink-3">
                <Link href="/settings?section=sla" className="text-brand hover:underline">
                  Set a resolution phone or email in Settings
                </Link>{" "}
                first.
              </span>
            ) : null}
            <span className="flex-1" />
            <Button type="button" size="sm" loading={saving} disabled={busy || !content.trim()} onClick={() => void save()}>
              Save reply
            </Button>
          </div>
        )}
        {error ? (
          <p className="text-[13px] text-bad" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
