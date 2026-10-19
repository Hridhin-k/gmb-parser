"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { roleLabel } from "@/lib/access";
import {
  ESCALATION_LEVELS,
  ESCALATION_TIMEZONES,
  RESOLUTION_ACTIONS,
  type EscalationPolicy,
} from "@/lib/escalations";
import { themeLabel } from "@/lib/review-inbox";
import type { EscalationQueueItem } from "@/lib/services/escalations";

interface Member {
  userId: string;
  email: string;
  role: string;
  scopeLabel: string;
}

interface BoardProps {
  bucket: "needs_human" | "in_progress" | "past_sla" | "resolved";
  counts: Record<BoardProps["bucket"], number>;
  items: Array<EscalationQueueItem & { remaining: string | null; overdue: string | null; dueLabel: string }>;
  policy: EscalationPolicy;
  pauses: { workspace: boolean; clientIds: string[]; locationIds: string[] };
  clients: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; clientId: string | null }>;
  members: Member[];
  canManage: boolean;
  query: string;
  page: number;
  totalPages: number;
}

const TABS = [
  { id: "needs_human", label: "Needs human" },
  { id: "in_progress", label: "In progress" },
  { id: "past_sla", label: "Past SLA" },
  { id: "resolved", label: "Resolved" },
] as const;

function eventLabel(action: string, metadata: Record<string, unknown>): string {
  if (action === "opened") {
    const reasons = metadata.reasons;
    if (Array.isArray(reasons) && reasons.includes("manager_requested")) {
      return "Opened because someone asked a manager to handle it.";
    }
    return "Opened from the complaint rules.";
  }
  if (action === "reopened") return "Reopened because the review changed.";
  if (action === "assigned") {
    const reason = typeof metadata.reason === "string" ? metadata.reason : "";
    const next = typeof metadata.assigneeId === "string" ? metadata.assigneeId : "someone";
    const previous = typeof metadata.previousAssigneeId === "string" ? metadata.previousAssigneeId : "nobody";
    return reason
      ? `Assignee changed from ${previous} to ${next}. Reason: ${reason}.`
      : "Assigned from the location manager rules.";
  }
  if (action === "fallback") return "Fallback owner. The configured location manager could not take this case.";
  if (action === "notified") return "Notice recorded for the current owner.";
  if (action === "overdue_noted") return "Still overdue at leadership. The level did not change again.";
  if (action === "level_changed") return `Handed to ${String(metadata.level ?? "the next level")}.`;
  if (action === "resolved") return "Resolution recorded. This does not confirm a callback, replacement, or visit.";
  if (action === "next_step") {
    return "Next step recorded. This does not mean the call, replacement, or visit happened.";
  }
  if (action === "reminder_recorded") {
    return `Reminder at ${String(metadata.kind ?? "")} hours recorded in GRM. No email or message was sent.`;
  }
  return action;
}

export function EscalationBoard(props: BoardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send(url: string, body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      created?: number;
    };
    setPending(false);
    if (!response.ok) {
      setError(payload.error ?? "That change could not be saved.");
      return;
    }
    if (url === "/api/escalations/policy") {
      const created = typeof payload.created === "number" ? payload.created : 0;
      if (created > 0) {
        toast.success(
          created === 1
            ? "Rules saved. Opened 1 matching case from synced reviews."
            : `Rules saved. Opened ${created} matching cases from synced reviews.`
        );
      } else {
        toast.success("Rules saved. No new matching cases in the recent synced reviews.");
      }
    }
    router.refresh();
  }

  const hrefFor = (bucket: string, page = 1) => {
    const params = new URLSearchParams(props.query);
    params.set("queue", bucket);
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    const text = params.toString();
    return text ? `/escalations?${text}` : "/escalations";
  };

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((tab) => (
          <a
            key={tab.id}
            href={hrefFor(tab.id)}
            className={
              props.bucket === tab.id
                ? "rounded-md bg-ink px-3 py-1.5 text-sm text-white"
                : "rounded-md border border-line px-3 py-1.5 text-sm text-ink"
            }
            aria-current={props.bucket === tab.id ? "page" : undefined}
          >
            {tab.label} ({props.counts[tab.id]})
          </a>
        ))}
        <a href={sortHref(props.query, props.bucket)} className="text-sm text-slate underline">
          {props.query.includes("sort=opened") ? "Sort by due time" : "Sort by opened time"}
        </a>
      </div>

      {props.items.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Nothing in this queue"
          description={emptyQueueCopy(props.bucket, props.counts, hrefFor)}
        />
      ) : (
        <ul className="space-y-3">
          {props.items.map((item) => (
            <li key={item.id} id={`case-${item.id}`} className="scroll-mt-24 rounded-xl bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {item.reviewerName} · {item.starRating}★
                  </p>
                  <p className="mt-1 text-sm text-slate">
                    {item.locationName}
                    {item.groupName ? ` · ${item.groupName}` : ""}
                    {item.clientName ? ` · ${item.clientName}` : ""}
                    {themeLabel(item.theme) ? ` · ${themeLabel(item.theme)}` : ""}
                  </p>
                  {item.comment ? <p className="mt-2 text-sm text-ink">{item.comment}</p> : null}
                </div>
                <div className="text-right text-sm text-slate">
                  <p>{item.status === "resolved" ? "Resolved" : item.status === "in_progress" ? "In progress" : "Needs human"}</p>
                  <p className="mt-1">{item.dueLabel}</p>
                  {item.remaining ? <p className="mt-1">{item.remaining} remaining</p> : null}
                  {item.overdue ? <p className="mt-1 text-red-700">{item.overdue} overdue</p> : null}
                </div>
              </div>

              <p className="mt-3 text-xs text-slate">
                Triggers: {item.triggerReasons.map((reason) => (reason === "recorded" ? "already open" : reason)).join(", ")}. These rules are keyword and star checks, not a model classification. Level: {item.level}. Reply status: {item.replyStatus}.
                {" "}Owner: {memberLabel(props.members, item.assignedTo)}. Responsible manager: {memberLabel(props.members, item.responsibleUserId)}.
                {item.ownership === "fallback" ? " Fallback: the location manager was missing, inactive, or not allowed to see this outlet." : ""}
                {item.replyStatus === "published"
                  ? " A public reply is on Google. This escalation stays open until someone records a resolution."
                  : " A public reply still needs owner or admin approval before it is published."}
              </p>

              {item.status !== "resolved" ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <ReassignForm
                    members={props.members}
                    assignedTo={item.assignedTo}
                    disabled={pending}
                    onAssign={(userId, reason) =>
                      send(`/api/escalations/${item.id}`, {
                        action: "assign",
                        userId,
                        reason,
                        expectedUpdatedAt: item.updatedAt,
                      })
                    }
                  />
                  {props.canManage ? (
                    <label className="text-xs text-slate">
                      Level
                      <select
                        className="mt-1 block rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                        value={item.level}
                        disabled={pending}
                        onChange={(event) =>
                          send(`/api/escalations/${item.id}`, { action: "level", level: event.target.value })
                        }
                      >
                        {ESCALATION_LEVELS.map((level) => (
                          <option key={level.id} value={level.id}>
                            {level.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <ResolveForm
                    disabled={pending}
                    onResolve={(code, note) => send(`/api/escalations/${item.id}`, { action: "resolve", code, note })}
                  />
                  <NoteForm
                    disabled={pending}
                    onNote={(body) => send(`/api/reviews/${item.reviewId}/workflow`, { action: "note", body })}
                  />
                  <a className="text-sm text-ink underline" href={`/reviews?q=${encodeURIComponent(item.reviewerName)}`}>
                    Open in inbox
                  </a>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate">
                  {RESOLUTION_ACTIONS.find((action) => action.id === item.resolutionCode)?.detail ??
                    "Resolved with a recorded next step."}
                  {item.resolutionNote ? ` Note: ${item.resolutionNote}` : ""}
                </p>
              )}

              {item.events.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-slate">
                  {item.events.map((event, index) => (
                    <li key={`${event.createdAt}-${index}`}>
                      {eventLabel(event.action, event.metadata as Record<string, unknown>)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-xs text-slate">File attachments are not available.</p>
            </li>
          ))}
        </ul>
      )}

      {props.totalPages > 1 ? (
        <div className="flex gap-2 text-sm">
          {props.page > 1 ? <a href={hrefFor(props.bucket, props.page - 1)}>Previous</a> : null}
          {props.page < props.totalPages ? <a href={hrefFor(props.bucket, props.page + 1)}>Next</a> : null}
        </div>
      ) : null}

      {props.canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <PolicyForm policy={props.policy} disabled={pending} onSave={(policy) => send("/api/escalations/policy", policy)} />
          <PauseForm
            pauses={props.pauses}
            clients={props.clients}
            locations={props.locations}
            disabled={pending}
            onChange={(body) => send("/api/escalations/pause", body)}
          />
        </div>
      ) : null}
    </div>
  );
}

function sortHref(query: string, bucket: string): string {
  const params = new URLSearchParams(query);
  params.set("queue", bucket);
  if (params.get("sort") === "opened") params.delete("sort");
  else params.set("sort", "opened");
  params.delete("page");
  const text = params.toString();
  return text ? `/escalations?${text}` : "/escalations";
}

function memberLabel(members: Member[], userId: string | null): string {
  if (!userId) return "nobody";
  const member = members.find((item) => item.userId === userId);
  return member ? member.email : "a former member";
}

function ReassignForm({
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
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState(assignedTo ?? "");
  const [reason, setReason] = useState("");
  const needle = query.trim().toLowerCase();
  const choices = members.filter((member) => {
    if (!needle) return true;
    return (
      member.email.toLowerCase().includes(needle) ||
      roleLabel(member.role).toLowerCase().includes(needle) ||
      member.scopeLabel.toLowerCase().includes(needle)
    );
  });
  const selected = members.find((member) => member.userId === userId);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!userId || reason.trim().length < 3) return;
        onAssign(userId, reason.trim());
        setReason("");
      }}
    >
      <label className="text-xs text-slate">
        Find a person
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, role, or scope"
          className="mt-1 block rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <label className="text-xs text-slate">
        Assignee
        <select
          className="mt-1 block max-w-xs rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
          value={choices.some((member) => member.userId === userId) ? userId : ""}
          disabled={disabled}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">Choose…</option>
          {choices.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.email} · {roleLabel(member.role)} · {member.scopeLabel}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate">
        Reason
        <input
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="mt-1 block rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <button type="submit" disabled={disabled || !userId || reason.trim().length < 3} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink disabled:opacity-40">
        Reassign
      </button>
      {selected ? (
        <p className="basis-full text-xs text-slate">
          {selected.email} is {roleLabel(selected.role)} for {selected.scopeLabel}. The responsible manager stays on the case.
        </p>
      ) : null}
    </form>
  );
}

function ResolveForm({
  disabled,
  onResolve,
}: {
  disabled: boolean;
  onResolve: (code: string, note: string) => void;
}) {
  const [code, setCode] = useState(RESOLUTION_ACTIONS[0].id);
  const [note, setNote] = useState("");
  const detail = RESOLUTION_ACTIONS.find((action) => action.id === code)?.detail;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onResolve(code, note);
        setNote("");
      }}
    >
      <label className="text-xs text-slate">
        Resolution
        <select
          className="mt-1 block rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
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
        className="rounded-md border border-line px-2 py-1.5 text-sm"
        placeholder="Internal note"
        value={note}
        maxLength={2000}
        onChange={(event) => setNote(event.target.value)}
      />
      <button type="submit" disabled={disabled} className="rounded-md bg-ink px-3 py-1.5 text-sm text-white">
        Record resolution
      </button>
      <span className="max-w-xs text-xs text-slate">{detail}</span>
    </form>
  );
}

function NoteForm({ disabled, onNote }: { disabled: boolean; onNote: (body: string) => void }) {
  const [body, setBody] = useState("");
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        onNote(body.trim());
        setBody("");
      }}
    >
      <input
        className="rounded-md border border-line px-2 py-1.5 text-sm"
        placeholder="Internal note"
        value={body}
        maxLength={2000}
        onChange={(event) => setBody(event.target.value)}
      />
      <button type="submit" disabled={disabled || !body.trim()} className="rounded-md border border-line px-3 py-1.5 text-sm">
        Save note
      </button>
    </form>
  );
}

function PolicyForm({
  policy,
  disabled,
  onSave,
}: {
  policy: EscalationPolicy;
  disabled: boolean;
  onSave: (policy: EscalationPolicy) => void;
}) {
  const [draft, setDraft] = useState(policy);
  const [keywords, setKeywords] = useState(policy.extraKeywords.join(", "));
  const [reminders, setReminders] = useState(policy.reminderHours.join(", "));
  return (
    <form
      className="space-y-3 rounded-xl bg-white p-4 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        const extraKeywords = keywords
          .split(",")
          .map((word) => word.trim().toLowerCase())
          .filter(Boolean);
        const reminderHours = reminders
          .split(",")
          .map((hour) => Number(hour.trim()))
          .filter((hour) => Number.isInteger(hour));
        onSave({ ...draft, extraKeywords, reminderHours });
      }}
    >
      <h2 className="text-sm font-medium text-ink">Complaint rules</h2>
      <label className="block text-xs text-slate">
        Stars at or below
        <input
          type="number"
          min={1}
          max={5}
          className="mt-1 block w-24 rounded-md border border-line px-2 py-1.5 text-sm"
          value={draft.maxStars}
          onChange={(event) => setDraft({ ...draft, maxStars: Number(event.target.value) })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={draft.flagProfanity}
          onChange={(event) => setDraft({ ...draft, flagProfanity: event.target.checked })}
        />
        Flag profanity
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={draft.flagLegalSafety}
          onChange={(event) => setDraft({ ...draft, flagLegalSafety: event.target.checked })}
        />
        Flag legal or safety wording
      </label>
      <label className="block text-xs text-slate">
        Extra keywords, comma separated
        <input
          className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
        />
      </label>
      <label className="block text-xs text-slate">
        Reminder hours
        <input
          className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm"
          value={reminders}
          onChange={(event) => setReminders(event.target.value)}
        />
      </label>
      <label className="block text-xs text-slate">
        Due after hours
        <input
          type="number"
          min={1}
          max={168}
          className="mt-1 block w-24 rounded-md border border-line px-2 py-1.5 text-sm"
          value={draft.dueHours}
          onChange={(event) => setDraft({ ...draft, dueHours: Number(event.target.value) })}
        />
      </label>
      <label className="block text-xs text-slate">
        Timezone for due times
        <select
          className="mt-1 block rounded-md border border-line bg-white px-2 py-1.5 text-sm"
          value={draft.timezone}
          onChange={(event) =>
            setDraft({ ...draft, timezone: event.target.value as EscalationPolicy["timezone"] })
          }
        >
          {ESCALATION_TIMEZONES.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={disabled} className="rounded-md bg-ink px-3 py-1.5 text-sm text-white">
        {disabled ? "Saving…" : "Save rules"}
      </button>
      <p className="text-xs text-slate">
        Saving scans recent synced reviews and opens cases that match these rules. Complaints already past the due
        window appear under Past SLA. Reminders are recorded in GRM. No email is sent.
      </p>
    </form>
  );
}

function emptyQueueCopy(
  bucket: BoardProps["bucket"],
  counts: BoardProps["counts"],
  hrefFor: (bucket: string) => string
): ReactNode {
  const past = counts.past_sla;
  const open =
    counts.needs_human + counts.in_progress + counts.past_sla;
  if (bucket === "needs_human" && past > 0) {
    return (
      <>
        No cases are still inside the due window. {past} matching complaint
        {past === 1 ? " is" : "s are"} already overdue — open{" "}
        <a href={hrefFor("past_sla")} className="font-medium text-[#163a7a] underline">
          Past SLA
        </a>
        . Publishing a reply does not close an escalation.
      </>
    );
  }
  if (bucket !== "resolved" && open === 0) {
    return "No open cases yet. Save the complaint rules below to scan synced reviews, or wait for the next matching review. Publishing a reply does not close an escalation.";
  }
  if (bucket === "resolved") {
    return "No resolved cases in this view. Resolve a case from Needs human, In progress, or Past SLA.";
  }
  return "A review appears here when it matches the star threshold, profanity, legal or safety wording, or an extra keyword. Publishing a reply does not close an escalation.";
}

function PauseForm({
  pauses,
  clients,
  locations,
  disabled,
  onChange,
}: {
  pauses: BoardProps["pauses"];
  clients: BoardProps["clients"];
  locations: BoardProps["locations"];
  disabled: boolean;
  onChange: (body: { scope: string; clientId: string | null; locationId: string | null; paused: boolean }) => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  return (
    <div className="space-y-3 rounded-xl bg-white p-4 shadow-card">
      <h2 className="text-sm font-medium text-ink">Pause automatic replies</h2>
      <p className="text-xs text-slate">
        A pause stops background reply generation for the selected scope, including work already waiting on the
        scheduler. People can still draft, approve, and publish by hand. There is no automatic sender running today.
      </p>
      <button
        type="button"
        disabled={disabled}
        className="rounded-md border border-line px-3 py-1.5 text-sm"
        onClick={() =>
          onChange({ scope: "workspace", clientId: null, locationId: null, paused: !pauses.workspace })
        }
      >
        {pauses.workspace ? "Resume workspace" : "Pause workspace"}
      </button>
      {clients.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <select
            aria-label="Client to pause"
            className="rounded-md border border-line bg-white px-2 py-1.5 text-sm"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={disabled || !clientId}
            className="rounded-md border border-line px-3 py-1.5 text-sm"
            onClick={() =>
              onChange({
                scope: "client",
                clientId,
                locationId: null,
                paused: !pauses.clientIds.includes(clientId),
              })
            }
          >
            {pauses.clientIds.includes(clientId) ? "Resume client" : "Pause client"}
          </button>
        </div>
      ) : null}
      {locations.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <select
            aria-label="Location to pause"
            className="rounded-md border border-line bg-white px-2 py-1.5 text-sm"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={disabled || !locationId}
            className="rounded-md border border-line px-3 py-1.5 text-sm"
            onClick={() =>
              onChange({
                scope: "location",
                clientId: null,
                locationId,
                paused: !pauses.locationIds.includes(locationId),
              })
            }
          >
            {pauses.locationIds.includes(locationId) ? "Resume location" : "Pause location"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
