"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REQUEST_CHANNELS, REQUEST_LANGUAGES, defaultTemplate, pageCopy, type RequestChannel, type RequestLanguage } from "@/lib/review-requests";
import type { CampaignSummary, QrSummary } from "@/lib/services/request-campaigns";
import type { MetricCell, RequestChannelOption } from "@/lib/review-requests";

interface LocationOption {
  id: string;
  name: string;
  storeCode: string | null;
  url: string | null;
}

interface RequestBoardProps {
  canManage: boolean;
  channels: RequestChannelOption[];
  metrics: MetricCell[];
  campaigns: CampaignSummary[];
  locations: LocationOption[];
  qrByLocation: Record<string, QrSummary>;
  policyDays: number;
  reviewId: string | null;
  clientId: string;
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!response.ok) return payload.error ?? "That did not save.";
  return payload.id ?? null;
}

export function RequestBoard(props: RequestBoardProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<RequestChannel>("qr");
  const [language, setLanguage] = useState<RequestLanguage>("en");
  const [template, setTemplate] = useState(defaultTemplate("en"));
  const [locations, setLocations] = useState<string[]>([]);
  const review = props.campaigns.find((campaign) => campaign.id === props.reviewId && campaign.status === "draft") ?? null;
  const previewName = props.locations.find((location) => location.id === locations[0])?.name ?? "this location";
  const copy = pageCopy(language, previewName);
  const selected = props.channels.find((item) => item.id === channel);

  async function run(task: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    const result = await task();
    setPending(false);
    if (result && /^[0-9a-f-]{36}$/i.test(result)) {
      const params = new URLSearchParams();
      if (props.clientId) params.set("client", props.clientId);
      params.set("campaign", result);
      router.push(params.size ? `/requests?${params.toString()}` : "/requests");
      router.refresh();
      return;
    }
    if (result) setError(result);
    else router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {props.metrics.map((metric) => (
          <article key={metric.id} className="rounded-xl bg-white p-4 shadow-card">
            <p className="text-xs text-slate">{metric.label}</p>
            <p className="mt-1 text-2xl font-medium text-ink">{metric.value}</p>
            <p className="mt-1 text-xs text-slate">{metric.note}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">Request limit</h2>
        <p className="mt-1 text-sm text-slate">One request per customer during this window. The server skips anyone contacted more recently. Opted-out customers are skipped too.</p>
        {props.canManage ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const failure = await send("/api/requests/policy", "POST", { cooldownDays: Number(form.get("cooldownDays")) });
                return failure;
              });
            }}
          >
            <label className="text-xs text-slate">
              Days
              <input name="cooldownDays" type="number" min={1} max={365} defaultValue={props.policyDays} className="mt-1 block w-24 rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
            </label>
            <button type="submit" disabled={pending} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink">
              Save limit
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-graphite">{props.policyDays} days</p>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">Channels</h2>
        <ul className="mt-3 divide-y divide-silver">
          {props.channels.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span className="font-medium text-graphite">{item.label}</span>
              <span className="text-right text-slate">{item.available ? (item.reason ?? "Ready") : item.reason}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-slate">No billing system is connected. Upload a CSV, or use an in-store QR code.</p>
      </section>

      {props.canManage ? (
        <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
          <h2 className="text-sm font-semibold text-graphite">New request</h2>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const file = form.get("csv");
                const csv = file instanceof File && file.size > 0 ? await file.text() : undefined;
                const failure = await send("/api/requests", "POST", {
                  name: String(form.get("name") ?? ""),
                  channel,
                  language,
                  template: channel === "qr" ? "" : template,
                  reminder: form.get("reminder") === "on",
                  locationIds: locations,
                  csv,
                });
                return failure;
              });
            }}
          >
            <label className="text-xs text-slate">
              Name
              <input name="name" required maxLength={80} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
            </label>
            <fieldset>
              <legend className="text-xs text-slate">Channel</legend>
              <div className="mt-1 flex flex-col gap-1 text-sm">
                {REQUEST_CHANNELS.map((item) => {
                  const option = props.channels.find((channelOption) => channelOption.id === item.id);
                  return (
                    <label key={item.id} className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="channel"
                        checked={channel === item.id}
                        disabled={!option?.available}
                        onChange={() => setChannel(item.id)}
                      />
                      <span>{item.label}</span>
                      {!option?.available ? <span className="text-slate">{option?.reason}</span> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {channel !== "qr" ? (
              <label className="text-xs text-slate">
                Customers
                <input name="csv" type="file" accept=".csv,text/csv" required className="mt-1 block w-full text-sm" />
                <span className="mt-1 block">Header: name, phone or email, store code. One file, up to 500 rows.</span>
              </label>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate">
                Language
                <select
                  className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink"
                  value={language}
                  onChange={(event) => {
                    const next = event.target.value as RequestLanguage;
                    setTemplate((current) => (current === defaultTemplate(language) ? defaultTemplate(next) : current));
                    setLanguage(next);
                  }}
                >
                  {REQUEST_LANGUAGES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block">This is the language of the page the customer opens. The message is the text you write.</span>
              </label>
              {channel !== "qr" ? (
                <label className="text-xs text-slate">
                  Template
                  <textarea value={template} onChange={(event) => setTemplate(event.target.value)} required maxLength={1000} rows={5} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
                  <span className="mt-1 block">{"Use {name}, {location}, {link}, and {optout}. An opt-out line is added when it is missing."}</span>
                </label>
              ) : null}
            </div>
            <fieldset>
              <legend className="text-xs text-slate">Locations</legend>
              <div className="mt-1 flex max-h-48 flex-col gap-1 overflow-auto text-sm">
                {props.locations.map((location) => (
                  <label key={location.id} className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={locations.includes(location.id)}
                      onChange={(event) =>
                        setLocations((current) =>
                          event.target.checked ? [...current, location.id] : current.filter((id) => id !== location.id)
                        )
                      }
                    />
                    {location.name}
                    {location.storeCode ? <span className="text-slate">{location.storeCode}</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
            {channel !== "qr" ? (
              <label className="inline-flex items-center gap-2 text-sm text-graphite">
                <input type="checkbox" name="reminder" />
                Send one reminder if they have not opened the page
              </label>
            ) : null}
            {selected && !selected.available ? <p className="text-sm text-slate">{selected.reason}</p> : null}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <button type="submit" disabled={pending || !selected?.available} className="w-fit rounded-md bg-ink px-3 py-1.5 text-sm text-white">
              Review and save
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">What the customer sees</h2>
        <p className="mt-1 text-sm text-slate">{copy.both}</p>
        <div className="mt-4 max-w-sm rounded-xl border border-line p-4">
          <p className="text-sm font-medium text-ink">{copy.question}</p>
          <p className="mt-3 block rounded-md bg-ink px-3 py-2 text-center text-sm text-white">{copy.google}</p>
          <p className="mt-2 block rounded-md border border-ink px-3 py-2 text-center text-sm text-ink">{copy.private}</p>
        </div>
      </section>

      {review && props.canManage ? (
        <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
          <h2 className="text-sm font-semibold text-graphite">Review {review.name}</h2>
          <ul className="mt-3 grid gap-2 text-sm text-graphite sm:grid-cols-2">
            <li>Ready to send: {review.preview.eligible}</li>
            <li>Inside the {props.policyDays}-day limit: {review.preview.suppressed}</li>
            <li>Opted out: {review.preview.optedOut}</li>
            <li>Missing phone or email: {review.preview.missingContact}</li>
            <li>Unknown store code: {review.preview.unknownStore}</li>
            <li>Duplicates in the file: {review.preview.duplicates}</li>
          </ul>
          <p className="mt-3 text-sm text-slate">Everyone who is sent the message gets the same text and the same page, with both choices on it.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className="rounded-md bg-ink px-3 py-1.5 text-sm text-white"
              onClick={() => void run(async () => send(`/api/requests/${review.id}/send`, "POST"))}
            >
              Send
            </button>
            {review.channel !== "qr" ? (
              <button
                type="button"
                disabled={pending}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink"
                onClick={() => void run(async () => send(`/api/requests/${review.id}/test`, "POST", {}))}
              >
                Send test
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-sm text-slate"
              onClick={() => void run(async () => send(`/api/requests/${review.id}`, "DELETE"))}
            >
              Delete
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-graphite">QR codes</h2>
          {props.locations.length > 0 ? (
            <a href={props.clientId ? `/api/requests/qr?format=pdf&client=${props.clientId}` : "/api/requests/qr?format=pdf"} className="text-sm text-ink hover:underline">
              Download all
            </a>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate">A scan opens that location’s page. A scan is not a Google review.</p>
        {props.locations.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No locations for this client.</p>
        ) : (
          <ul className="mt-3 divide-y divide-silver">
            {props.locations.map((location) => {
              const qr = props.qrByLocation[location.id];
              return (
                <li key={location.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-graphite">{location.name}</p>
                    <p className="text-sm text-slate">
                      {qr
                        ? `${qr.scans.toLocaleString("en-US")} ${qr.scans === 1 ? "scan" : "scans"} · ${qr.feedback.toLocaleString("en-US")} private ${qr.feedback === 1 ? "note" : "notes"}`
                        : "Preparing the code"}
                    </p>
                  </div>
                  {qr ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <img src={`/api/requests/qr/${location.id}?format=svg`} alt="" width={72} height={72} className="h-[72px] w-[72px] border border-line bg-white" />
                      <a href={`/api/requests/qr/${location.id}?format=pdf`} className="text-sm text-ink hover:underline">
                        Counter card
                      </a>
                      <a href={qr.url} className="text-sm text-ink hover:underline">
                        Preview
                      </a>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">Recent sends</h2>
        {props.campaigns.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No campaigns yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-slate">
                <tr>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Source</th>
                  <th className="py-2 font-medium">Channel</th>
                  <th className="py-2 font-medium">Locations</th>
                  <th className="py-2 font-medium">Sent</th>
                  <th className="py-2 font-medium">Opened</th>
                  <th className="py-2 font-medium">New reviews</th>
                  {props.canManage ? <th className="py-2 font-medium"> </th> : null}
                </tr>
              </thead>
              <tbody>
                {props.campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-t border-silver align-top">
                    <td className="py-2 text-graphite">{new Date(campaign.sentAt ?? campaign.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    <td className="py-2">{campaign.source === "qr" ? "QR codes" : "CSV upload"}</td>
                    <td className="py-2">{campaign.channel === "qr" ? "In store" : campaign.channel}</td>
                    <td className="py-2">{campaign.locations}</td>
                    <td className="py-2">
                      {campaign.channel === "qr" ? "—" : campaign.status === "draft" ? "Not sent" : campaign.sent}
                      {campaign.queued > 0 ? <span className="block text-xs text-slate">{campaign.queued} still queued</span> : null}
                      {campaign.failed > 0 ? <span className="block text-xs text-red-700">{campaign.failed} failed</span> : null}
                      {campaign.unavailable > 0 ? <span className="block text-xs text-slate">{campaign.unavailable} unavailable</span> : null}
                      {campaign.lastError ? <span className="block text-xs text-red-700">{campaign.lastError}</span> : null}
                    </td>
                    <td className="py-2">
                      {campaign.channel === "qr"
                        ? "—"
                        : props.metrics.find((metric) => metric.id === "opened")?.value === "Not confirmed"
                          ? "Not confirmed"
                          : campaign.opened}
                    </td>
                    <td className="py-2 text-slate">Not available</td>
                    {props.canManage ? (
                      <td className="py-2">
                        <button type="button" className="text-slate hover:underline" disabled={pending} onClick={() => void run(async () => send(`/api/requests/${campaign.id}`, "DELETE"))}>
                          Delete
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
