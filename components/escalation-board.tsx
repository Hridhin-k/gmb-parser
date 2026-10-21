"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  ESCALATION_TIMEZONES,
  escalationStatusLabel,
  ticketKey,
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
        <div className="overflow-x-auto rounded-xl bg-white shadow-card">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-xs text-slate">
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Case</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((item) => (
                <tr key={item.id} id={`case-${item.id}`} className="scroll-mt-24 border-t border-silver">
                  <td className="px-4 py-3 font-medium text-ink">
                    <a href={`/escalations/${item.id}`} className="hover:underline">
                      {ticketKey(item.ticketNo)}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <a href={`/escalations/${item.id}`} className="text-ink hover:underline">
                      {item.reviewerName} · {item.starRating}★
                    </a>
                    <p className="mt-0.5 text-xs text-slate">
                      {item.locationName}
                      {themeLabel(item.theme) ? ` · ${themeLabel(item.theme)}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-ink">{escalationStatusLabel(item.status)}</td>
                  <td className="px-4 py-3 text-slate">{memberLabel(props.members, item.assignedTo)}</td>
                  <td className="px-4 py-3 text-slate">
                    {item.dueLabel}
                    {item.overdue ? <span className="mt-0.5 block text-red-700">{item.overdue} overdue</span> : null}
                    {item.remaining ? <span className="mt-0.5 block">{item.remaining} left</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
