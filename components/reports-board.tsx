"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ALERT_KINDS, REPORT_FREQUENCIES, REPORT_SECTIONS, type ChannelOption } from "@/lib/reporting";
import type { AlertEventRow, AlertRuleRow, ReportRunRow, SavedReport } from "@/lib/services/reporting";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface ScopeOption {
  id: string;
  name: string;
}

interface ReportsBoardProps {
  canManage: boolean;
  channels: ChannelOption[];
  members: string[];
  clients: ScopeOption[];
  groups: ScopeOption[];
  locations: ScopeOption[];
  reports: SavedReport[];
  runs: ReportRunRow[];
  rules: AlertRuleRow[];
  events: AlertEventRow[];
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) return payload.error ?? "That did not save.";
  return null;
}

export function ReportsBoard(props: ReportsBoardProps) {
  const router = useRouter();
  const [reportError, setReportError] = useState<string | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editingReport, setEditingReport] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<string | null>(null);

  async function run(task: () => Promise<string | null>, setError: (value: string | null) => void) {
    setPending(true);
    setError(null);
    const error = await task();
    setPending(false);
    if (error) {
      setError(error);
      return;
    }
    setEditingReport(null);
    setEditingRule(null);
    router.refresh();
  }

  const report = props.reports.find((item) => item.id === editingReport) ?? null;
  const rule = props.rules.find((item) => item.id === editingRule) ?? null;

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">Delivery channels</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {props.channels.map((channel) => (
            <li key={channel.id} className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <span className="font-medium text-graphite">{channel.label}</span>
              <span className="text-slate">{channel.available ? (channel.reason ?? "Available") : channel.reason}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-graphite">Scheduled reports</h2>
        </div>
        {props.reports.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No reports yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-silver">
            {props.reports.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-graphite">{item.name}</p>
                  <p className="mt-0.5 text-sm text-slate">
                    {item.frequency} at {item.deliveryTime} ({item.timezone})
                    {item.enabled ? "" : " · paused"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Link href={`/reports/${item.id}`} className="text-ink hover:underline">
                    Preview
                  </Link>
                  <a href={`/api/reports/${item.id}/pdf`} className="text-ink hover:underline">
                    PDF
                  </a>
                  <a href={`/api/reports/${item.id}/csv`} className="text-ink hover:underline">
                    CSV
                  </a>
                  {props.canManage ? (
                    <>
                      <button type="button" className="text-ink hover:underline" onClick={() => setEditingReport(item.id)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-ink hover:underline"
                        disabled={pending}
                        onClick={() =>
                          void run(() => send(`/api/reports/${item.id}/test`, "POST"), setReportError)
                        }
                      >
                        Send test
                      </button>
                      <button
                        type="button"
                        className="text-slate hover:underline"
                        disabled={pending}
                        onClick={() => void run(() => send(`/api/reports/${item.id}`, "DELETE"), setReportError)}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {props.canManage ? (
          <ReportForm
            key={report?.id ?? "new-report"}
            report={report}
            channels={props.channels}
            members={props.members}
            clients={props.clients}
            groups={props.groups}
            locations={props.locations}
            pending={pending}
            error={reportError}
            onSubmit={(body) =>
              void run(
                () => send(report ? `/api/reports/${report.id}` : "/api/reports", report ? "PATCH" : "POST", body),
                setReportError
              )
            }
          />
        ) : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">Recent report runs</h2>
        {props.runs.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No runs yet. A test or a due schedule records one here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-silver">
            {props.runs.map((run) => (
              <li key={run.id} className="py-3 text-sm">
                <p className="font-medium text-graphite">
                  {run.reportName} · {run.trigger} · {run.status}
                  {run.attempts > 1 ? ` · attempt ${run.attempts}` : ""}
                </p>
                {run.error ? <p className="mt-1 text-red-700">{run.error}</p> : null}
                <ul className="mt-1 space-y-0.5 text-slate">
                  {run.deliveries.map((delivery) => (
                    <li key={`${delivery.channel}-${delivery.recipient}`}>
                      {delivery.channel} · {delivery.recipient} · {delivery.status}
                      {delivery.detail ? ` · ${delivery.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-graphite">Alert rules</h2>
          {props.canManage ? (
            <button
              type="button"
              className="rounded-md border border-line px-3 py-1.5 text-sm"
              disabled={pending}
              onClick={() => void run(() => send("/api/alerts/run", "POST"), setAlertError)}
            >
              Check now
            </button>
          ) : null}
        </div>
        {props.rules.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No alert rules yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-silver">
            {props.rules.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-graphite">{item.name}</p>
                  <p className="mt-0.5 text-sm text-slate">
                    {ALERT_KINDS.find((kind) => kind.id === item.kind)?.label} · {item.enabled ? "On" : "Off"}
                  </p>
                </div>
                {props.canManage ? (
                  <div className="flex gap-3 text-sm">
                    <button type="button" className="text-ink hover:underline" onClick={() => setEditingRule(item.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-slate hover:underline"
                      disabled={pending}
                      onClick={() => void run(() => send(`/api/alerts/${item.id}`, "DELETE"), setAlertError)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {props.canManage ? (
          <AlertForm
            key={rule?.id ?? "new-rule"}
            rule={rule}
            channels={props.channels}
            members={props.members}
            clients={props.clients}
            groups={props.groups}
            locations={props.locations}
            pending={pending}
            error={alertError}
            onSubmit={(body) =>
              void run(
                () => send(rule ? `/api/alerts/${rule.id}` : "/api/alerts", rule ? "PATCH" : "POST", body),
                setAlertError
              )
            }
          />
        ) : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">Alert history</h2>
        {props.events.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No alerts have matched. A repeated check does not record the same event twice.</p>
        ) : (
          <ul className="mt-3 divide-y divide-silver">
            {props.events.map((event) => (
              <li key={event.id} className="py-3 text-sm">
                <p className="font-medium text-graphite">{event.ruleName}</p>
                <p className="mt-1 text-slate">{event.summary}</p>
                <ul className="mt-1 space-y-0.5 text-slate">
                  {event.deliveries.map((delivery) => (
                    <li key={`${delivery.channel}-${delivery.recipient}`}>
                      {delivery.channel} · {delivery.recipient} · {delivery.status}
                      {delivery.detail ? ` · ${delivery.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReportForm(props: {
  report: SavedReport | null;
  channels: ChannelOption[];
  members: string[];
  clients: ScopeOption[];
  groups: ScopeOption[];
  locations: ScopeOption[];
  pending: boolean;
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const initialScope = props.report?.locationId
    ? "location"
    : props.report?.groupId
      ? "group"
      : props.report?.clientId
        ? "client"
        : "workspace";
  const [scope, setScope] = useState(initialScope);
  const [scopeId, setScopeId] = useState(props.report?.locationId ?? props.report?.groupId ?? props.report?.clientId ?? "");
  const [frequency, setFrequency] = useState(props.report?.frequency ?? "weekly");
  const [sections, setSections] = useState<string[]>(props.report?.sections ?? ["scorecard", "trends", "leaderboard", "themes"]);
  const [recipients, setRecipients] = useState<string[]>(props.report?.recipients ?? []);
  const [channels, setChannels] = useState<string[]>(
    (props.report?.channels ?? ["in_app"]).filter(
      (channel) => channel === "in_app" || props.channels.some((item) => item.id === channel && item.available)
    )
  );

  const options = scope === "client" ? props.clients : scope === "group" ? props.groups : props.locations;

  return (
    <form
      className="mt-4 grid gap-3 border-t border-silver pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        props.onSubmit({
          name: String(form.get("name") ?? ""),
          scope,
          scopeId: scope === "workspace" ? null : scopeId || null,
          sections,
          frequency,
          deliveryTime: String(form.get("deliveryTime") ?? "09:00"),
          timezone: String(form.get("timezone") ?? "Asia/Kolkata"),
          weekday: frequency === "weekly" ? Number(form.get("weekday")) : null,
          dayOfMonth: frequency === "monthly" ? Number(form.get("dayOfMonth")) : null,
          recipients,
          channels,
          enabled: form.get("enabled") === "on",
        });
      }}
    >
      <p className="text-sm font-medium text-graphite">{props.report ? "Edit report" : "New report"}</p>
      <label className="text-xs text-slate">
        Name
        <input name="name" required maxLength={80} defaultValue={props.report?.name ?? ""} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate">
          Scope
          <select
            className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setScopeId("");
            }}
          >
            <option value="workspace">Whole workspace</option>
            <option value="client">Brand</option>
            <option value="group">Group</option>
            <option value="location">Location</option>
          </select>
        </label>
        {scope !== "workspace" ? (
          <label className="text-xs text-slate">
            {scope === "client" ? "Brand" : scope === "group" ? "Group" : "Location"}
            <select className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
              <option value="">Choose</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <fieldset>
        <legend className="text-xs text-slate">Sections</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {REPORT_SECTIONS.map((section) => (
            <label key={section.id} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={sections.includes(section.id)}
                onChange={(event) =>
                  setSections((current) =>
                    event.target.checked ? [...current, section.id] : current.filter((item) => item !== section.id)
                  )
                }
              />
              {section.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate">Competitor comparison says ratings are not connected. It does not estimate them.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate">
          Frequency
          <select className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" value={frequency} onChange={(event) => setFrequency(event.target.value as SavedReport["frequency"])}>
            {REPORT_FREQUENCIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate">
          Delivery time
          <input name="deliveryTime" type="time" required defaultValue={props.report?.deliveryTime ?? "09:00"} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="text-xs text-slate">
          Timezone
          <select name="timezone" defaultValue={props.report?.timezone ?? "Asia/Kolkata"} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink">
            <option value="Asia/Kolkata">India (Asia/Kolkata)</option>
            <option value="UTC">UTC</option>
            <option value="Asia/Dubai">Gulf (Asia/Dubai)</option>
            <option value="America/New_York">US Eastern (America/New_York)</option>
          </select>
        </label>
      </div>
      {frequency === "weekly" ? (
        <label className="text-xs text-slate">
          Weekday
          <select name="weekday" defaultValue={props.report?.weekday ?? 1} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink sm:w-48">
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {frequency === "monthly" ? (
        <label className="text-xs text-slate">
          Day of month
          <input name="dayOfMonth" type="number" min={1} max={28} defaultValue={props.report?.dayOfMonth ?? 1} className="mt-1 block w-24 rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
        </label>
      ) : null}
      <fieldset>
        <legend className="text-xs text-slate">Recipients</legend>
        <div className="mt-1 flex flex-col gap-1 text-sm">
          {props.members.map((email) => (
            <label key={email} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={recipients.includes(email)}
                onChange={(event) =>
                  setRecipients((current) =>
                    event.target.checked ? [...current, email] : current.filter((item) => item !== email)
                  )
                }
              />
              {email}
            </label>
          ))}
        </div>
      </fieldset>
      <ChannelFields channels={props.channels} selected={channels} onChange={setChannels} />
      <label className="inline-flex items-center gap-2 text-sm text-graphite">
        <input type="checkbox" name="enabled" defaultChecked={props.report?.enabled ?? true} />
        Schedule is on
      </label>
      {props.error ? <p className="text-sm text-red-700">{props.error}</p> : null}
      <button type="submit" disabled={props.pending} className="w-fit rounded-md bg-ink px-3 py-1.5 text-sm text-white">
        {props.report ? "Save report" : "Create report"}
      </button>
    </form>
  );
}

function AlertForm(props: {
  rule: AlertRuleRow | null;
  channels: ChannelOption[];
  members: string[];
  clients: ScopeOption[];
  groups: ScopeOption[];
  locations: ScopeOption[];
  pending: boolean;
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const initialScope = props.rule?.locationId ? "location" : props.rule?.groupId ? "group" : props.rule?.clientId ? "client" : "workspace";
  const [scope, setScope] = useState(initialScope);
  const [scopeId, setScopeId] = useState(props.rule?.locationId ?? props.rule?.groupId ?? props.rule?.clientId ?? "");
  const [kind, setKind] = useState(props.rule?.kind ?? "negative_reviews");
  const [recipients, setRecipients] = useState<string[]>(props.rule?.recipients ?? []);
  const [channels, setChannels] = useState<string[]>(
    (props.rule?.channels ?? ["in_app"]).filter(
      (channel) => channel === "in_app" || props.channels.some((item) => item.id === channel && item.available)
    )
  );
  const options = scope === "client" ? props.clients : scope === "group" ? props.groups : props.locations;
  const kindDetail = ALERT_KINDS.find((item) => item.id === kind)?.detail;

  return (
    <form
      className="mt-4 grid gap-3 border-t border-silver pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        props.onSubmit({
          name: String(form.get("name") ?? ""),
          kind,
          scope,
          scopeId: scope === "workspace" ? null : scopeId || null,
          enabled: form.get("enabled") === "on",
          recipients,
          channels,
          threshold: Number(form.get("threshold")),
          windowDays: Number(form.get("windowDays")),
          minReviews: Number(form.get("minReviews")),
          dropPoints: Number(form.get("dropPoints")),
          multiplier: Number(form.get("multiplier")),
        });
      }}
    >
      <p className="text-sm font-medium text-graphite">{props.rule ? "Edit alert" : "New alert"}</p>
      <label className="text-xs text-slate">
        Name
        <input name="name" required maxLength={80} defaultValue={props.rule?.name ?? ""} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
      </label>
      <label className="text-xs text-slate">
        Rule
        <select className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" value={kind} onChange={(event) => setKind(event.target.value as AlertRuleRow["kind"])}>
          {ALERT_KINDS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate">{kindDetail}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate">
          Scope
          <select className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" value={scope} onChange={(event) => { setScope(event.target.value); setScopeId(""); }}>
            <option value="workspace">Whole workspace</option>
            <option value="client">Brand</option>
            <option value="group">Group</option>
            <option value="location">Location</option>
          </select>
        </label>
        {scope !== "workspace" ? (
          <label className="text-xs text-slate">
            {scope === "client" ? "Brand" : scope === "group" ? "Group" : "Location"}
            <select className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
              <option value="">Choose</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField name="threshold" label="Count" defaultValue={props.rule?.threshold ?? 3} />
        <NumberField name="windowDays" label="Window (days)" defaultValue={props.rule?.windowDays ?? 1} />
        <NumberField name="minReviews" label="Minimum reviews" defaultValue={props.rule?.minReviews ?? 5} />
        <NumberField name="dropPoints" label="Rating drop" step="0.1" defaultValue={props.rule?.dropPoints ?? 0.5} />
        <NumberField name="multiplier" label="Burst multiple" step="0.1" defaultValue={props.rule?.multiplier ?? 2} />
      </div>
      <fieldset>
        <legend className="text-xs text-slate">Recipients</legend>
        <div className="mt-1 flex flex-col gap-1 text-sm">
          {props.members.map((email) => (
            <label key={email} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={recipients.includes(email)}
                onChange={(event) =>
                  setRecipients((current) => (event.target.checked ? [...current, email] : current.filter((item) => item !== email)))
                }
              />
              {email}
            </label>
          ))}
        </div>
      </fieldset>
      <ChannelFields channels={props.channels} selected={channels} onChange={setChannels} />
      <label className="inline-flex items-center gap-2 text-sm text-graphite">
        <input type="checkbox" name="enabled" defaultChecked={props.rule?.enabled ?? true} />
        Rule is on
      </label>
      {props.error ? <p className="text-sm text-red-700">{props.error}</p> : null}
      <button type="submit" disabled={props.pending} className="w-fit rounded-md bg-ink px-3 py-1.5 text-sm text-white">
        {props.rule ? "Save alert" : "Create alert"}
      </button>
    </form>
  );
}

function NumberField({ name, label, defaultValue, step }: { name: string; label: string; defaultValue: number; step?: string }) {
  return (
    <label className="text-xs text-slate">
      {label}
      <input name={name} type="number" step={step ?? "1"} required defaultValue={defaultValue} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
    </label>
  );
}

function ChannelFields({
  channels,
  selected,
  onChange,
}: {
  channels: ChannelOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs text-slate">Channels</legend>
      <div className="mt-1 flex flex-col gap-1 text-sm">
        {channels.map((channel) => {
          const locked = channel.id === "in_app";
          return (
            <label key={channel.id} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={locked || selected.includes(channel.id)}
                disabled={locked || !channel.available}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, channel.id]
                      : selected.filter((item) => item !== channel.id)
                  )
                }
              />
              <span>
                {channel.label}
                {!channel.available && channel.reason ? ` — ${channel.reason}` : ""}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
