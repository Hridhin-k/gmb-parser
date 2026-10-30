"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Download, FileText, Inbox, MoreHorizontal, QrCode, Search, Send, Trash2 } from "lucide-react";
import { REQUEST_CHANNELS, REQUEST_LANGUAGES, defaultTemplate, pageCopy, type RequestChannel, type RequestLanguage } from "@/lib/review-requests";
import type { CampaignSummary, QrSummary } from "@/lib/services/request-campaigns";
import type { MetricCell, RequestChannelOption } from "@/lib/review-requests";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { RequestsPolicyCard } from "@/components/requests-policy-card";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type RequestView = "campaigns" | "new" | "qr" | "settings";

interface LocationOption {
  id: string;
  name: string;
  storeCode: string | null;
  url: string | null;
}

interface RequestBoardProps {
  /** Which tab of the Review requests page to render. Defaults to campaigns. */
  view?: RequestView;
  canManage: boolean;
  channels: RequestChannelOption[];
  metrics: MetricCell[];
  campaigns: CampaignSummary[];
  locations: LocationOption[];
  qrByLocation: Record<string, QrSummary>;
  policyDays: number;
  reviewId: string | null;
  clientId: string;
  /** Current scope/period query (without tab/campaign), kept on internal links. */
  baseQuery?: string;
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

const QR_PAGE_SIZE = 20;

function channelLabel(channel: string) {
  if (channel === "qr") return "In-store QR";
  return REQUEST_CHANNELS.find((item) => item.id === channel)?.label ?? channel;
}

function campaignStatus(campaign: CampaignSummary): { label: string; variant: "default" | "ok" | "info" | "warn" | "bad" } {
  switch (campaign.status) {
    case "draft":
      return { label: "Draft", variant: "default" };
    case "ready":
      return { label: campaign.channel === "qr" ? "Active" : "Ready", variant: "ok" };
    case "sending":
      return { label: "Sending", variant: "info" };
    case "sent":
      if (campaign.failed > 0 || campaign.unavailable > 0) return { label: "Partial", variant: "warn" };
      if (campaign.queued > 0) return { label: "In progress", variant: "info" };
      return { label: "Sent", variant: "ok" };
    case "failed":
      return { label: "Failed", variant: "bad" };
    default:
      return { label: campaign.status.replaceAll("_", " "), variant: "default" };
  }
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function RequestBoard(props: RequestBoardProps) {
  const router = useRouter();
  const view = props.view ?? "campaigns";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<RequestChannel>("qr");
  const [language, setLanguage] = useState<RequestLanguage>("en");
  const [template, setTemplate] = useState(defaultTemplate("en"));
  const [locations, setLocations] = useState<string[]>([]);
  const [locationQuery, setLocationQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<CampaignSummary | null>(null);
  const review = props.campaigns.find((campaign) => campaign.id === props.reviewId && campaign.status === "draft") ?? null;
  const reviewedElsewhere = props.reviewId && !review ? props.campaigns.find((campaign) => campaign.id === props.reviewId) ?? null : null;
  const previewName = props.locations.find((location) => location.id === locations[0])?.name ?? "this location";
  const copy = pageCopy(language, previewName);
  const selected = props.channels.find((item) => item.id === channel);
  const openedUnconfirmed = props.metrics.find((metric) => metric.id === "opened")?.value === "Not confirmed";
  const deliveredUnconfirmed = props.metrics.find((metric) => metric.id === "delivered")?.value === "Not confirmed";

  function href(extra: Record<string, string>) {
    const params = new URLSearchParams(props.baseQuery ?? "");
    if (!props.baseQuery && props.clientId) params.set("client", props.clientId);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return params.size ? `/requests?${params.toString()}` : "/requests";
  }

  async function run(task: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    const result = await task();
    setPending(false);
    if (result && /^[0-9a-f-]{36}$/i.test(result)) {
      router.push(href({ campaign: result }));
      router.refresh();
      return;
    }
    if (result) setError(result);
    else router.refresh();
  }

  const deleteDialog = (
    <ConfirmDialog
      open={confirmDelete !== null}
      onOpenChange={(open) => {
        if (!open) setConfirmDelete(null);
      }}
      title={confirmDelete?.status === "draft" ? "Delete this draft?" : "Delete this campaign?"}
      description={
        confirmDelete ? (
          <>
            <span className="font-medium text-ink">{confirmDelete.name}</span> is removed from this list.
            {confirmDelete.status !== "draft" ? " Messages that were already sent are not recalled." : ""}
          </>
        ) : null
      }
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      tone="danger"
      onConfirm={async () => {
        if (!confirmDelete) return;
        const id = confirmDelete.id;
        await run(async () => send(`/api/requests/${id}`, "DELETE"));
      }}
    />
  );

  if (view === "qr") {
    return <QrPanel {...props} />;
  }

  if (view === "settings") {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="text-sm font-semibold text-ink">Request limit</h2>
            <p className="mt-1 text-[13px] text-ink-3">
              One request per customer during this window. The server skips anyone contacted more recently. Opted-out customers are skipped too.
            </p>
            {props.canManage ? (
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    const failure = await send("/api/requests/policy", "POST", { cooldownDays: Number(form.get("cooldownDays")) });
                    return failure;
                  });
                }}
              >
                <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
                  Days between requests
                  <Input name="cooldownDays" type="number" min={1} max={365} defaultValue={props.policyDays} className="w-28" />
                </label>
                <Button type="submit" variant="outline" loading={pending}>
                  Save limit
                </Button>
              </form>
            ) : (
              <p className="mt-3 text-[13px] text-ink">
                {props.policyDays} days <span className="text-xs text-ink-3">· An owner or admin can change this.</span>
              </p>
            )}
            {error ? (
              <p className="mt-2 text-xs text-bad" role="alert">
                {error}
              </p>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Channels</h2>
              <p className="mt-0.5 text-xs text-ink-3">WhatsApp, SMS and email send only when that provider is configured.</p>
            </div>
            <ul className="divide-y divide-line-2">
              {props.channels.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-[13px]">
                  <span className="font-medium text-ink">{item.label}</span>
                  <span className="flex flex-wrap items-center justify-end gap-2 text-right text-xs text-ink-3">
                    {item.reason ? <span>{item.reason}</span> : null}
                    <Badge variant={item.available ? "ok" : "default"}>{item.available ? "Ready" : "Not configured"}</Badge>
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
              No billing system is connected. Upload a CSV, or use an in-store QR code.
            </p>
          </section>
        </div>
        <RequestsPolicyCard policyDays={props.policyDays} />
      </div>
    );
  }

  if (view === "new") {
    const needle = locationQuery.trim().toLowerCase();
    const locationChoices = needle
      ? props.locations.filter(
          (location) =>
            location.name.toLowerCase().includes(needle) || (location.storeCode ?? "").toLowerCase().includes(needle)
        )
      : props.locations;
    const step = review ? 3 : 1;

    return (
      <div className="flex flex-col gap-4">
        <ol className="flex flex-wrap items-center gap-2 text-xs text-ink-3" aria-label="Steps">
          {["Channel & recipients", "Message", "Review & send"].map((label, index) => {
            const number = index + 1;
            const done = review ? number < 3 : false;
            const on = review ? number === 3 : number < 3;
            return (
              <li key={label} className="flex items-center gap-2">
                {index > 0 ? <span className="h-px w-6 bg-line" aria-hidden /> : null}
                <span
                  className={cn(
                    "inline-flex size-[22px] items-center justify-center rounded-full border text-[11px] font-semibold",
                    done && "border-ok bg-ok text-white",
                    on && !done && "border-brand bg-brand text-white",
                    !on && !done && "border-line bg-white"
                  )}
                >
                  {done ? "✓" : number}
                </span>
                <span className={cn(on && "font-semibold text-ink")} aria-current={number === step ? "step" : undefined}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>

        {reviewedElsewhere ? (
          <Banner
            tone="info"
            title={`${reviewedElsewhere.name} is no longer a draft.`}
            actions={
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={href({})} />}>
                See campaigns
              </Button>
            }
          >
            Its delivery status is on the Campaigns tab.
          </Banner>
        ) : null}

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            {review ? (
              <section className="overflow-hidden rounded-lg border border-line bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Review {review.name}</h2>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {channelLabel(review.channel)} · {review.locations} {review.locations === 1 ? "location" : "locations"} · saved{" "}
                      {formatDay(review.createdAt)}
                    </p>
                  </div>
                  <Badge>Draft</Badge>
                </div>
                <div className="flex flex-col gap-3 px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="ok">{review.preview.eligible.toLocaleString("en-US")} ready to send</Badge>
                    {review.preview.suppressed > 0 ? (
                      <Badge variant="warn">
                        {review.preview.suppressed.toLocaleString("en-US")} inside the {props.policyDays}-day limit (skipped)
                      </Badge>
                    ) : null}
                    {review.preview.optedOut > 0 ? <Badge>{review.preview.optedOut.toLocaleString("en-US")} opted out (skipped)</Badge> : null}
                    {review.preview.missingContact > 0 ? (
                      <Badge variant="bad">{review.preview.missingContact.toLocaleString("en-US")} missing phone or email</Badge>
                    ) : null}
                    {review.preview.unknownStore > 0 ? (
                      <Badge variant="bad">{review.preview.unknownStore.toLocaleString("en-US")} unknown store code</Badge>
                    ) : null}
                    {review.preview.duplicates > 0 ? (
                      <Badge variant="warn">{review.preview.duplicates.toLocaleString("en-US")} duplicates in the file</Badge>
                    ) : null}
                  </div>
                  {review.preview.missingContact + review.preview.unknownStore > 0 ? (
                    <Banner tone="warn" title="Some rows can’t be sent.">
                      Rows without a phone or email, or with a store code that matches no location, are left out. To include them, fix the CSV,
                      delete this draft and upload it again.
                    </Banner>
                  ) : null}
                  <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
                    {[
                      ["Ready to send", review.preview.eligible],
                      [`Inside the ${props.policyDays}-day limit`, review.preview.suppressed],
                      ["Opted out", review.preview.optedOut],
                      ["Missing phone or email", review.preview.missingContact],
                      ["Unknown store code", review.preview.unknownStore],
                      ["Duplicates in the file", review.preview.duplicates],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="flex justify-between gap-3 border-b border-line-2 py-1">
                        <dt className="text-ink-3">{label}</dt>
                        <dd className="tabular-nums text-ink">{Number(value).toLocaleString("en-US")}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-ink-3">
                    Everyone who is sent the message gets the same text and the same page, with both choices on it.
                  </p>
                  {error ? (
                    <p className="text-xs text-bad" role="alert">
                      {error}
                    </p>
                  ) : null}
                </div>
                {props.canManage ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
                    <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => setConfirmDelete(review)}>
                      <Trash2 aria-hidden />
                      Delete draft
                    </Button>
                    <div className="flex flex-wrap gap-2">
                      {review.channel !== "qr" ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={() => void run(async () => send(`/api/requests/${review.id}/test`, "POST", {}))}
                        >
                          Send me a test
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        loading={pending}
                        onClick={() => void run(async () => send(`/api/requests/${review.id}/send`, "POST"))}
                      >
                        <Send aria-hidden />
                        {review.channel === "qr"
                          ? "Activate QR campaign"
                          : `Send to ${review.preview.eligible.toLocaleString("en-US")} ${review.preview.eligible === 1 ? "customer" : "customers"}`}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : (
              <form
                className="flex flex-col gap-4"
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
                <section className="flex flex-col gap-4 rounded-lg border border-line bg-white p-4">
                  <h2 className="text-sm font-semibold text-ink">Channel & recipients</h2>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
                    Campaign name
                    <Input name="name" required maxLength={80} placeholder="For example: October catering customers" />
                  </label>
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1.5 text-xs font-medium text-ink-2">Channel</legend>
                    <div className="flex flex-wrap gap-2">
                      {REQUEST_CHANNELS.map((item) => {
                        const option = props.channels.find((channelOption) => channelOption.id === item.id);
                        const disabled = !option?.available;
                        return (
                          <label
                            key={item.id}
                            title={disabled ? (option?.reason ?? "Not configured") : undefined}
                            className={cn(
                              "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[13px] font-medium",
                              channel === item.id ? "border-brand-line bg-brand-tint text-brand" : "border-line bg-white text-ink-2",
                              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                            )}
                          >
                            <input
                              type="radio"
                              name="channel"
                              className="accent-brand"
                              checked={channel === item.id}
                              disabled={disabled}
                              onChange={() => setChannel(item.id)}
                            />
                            {item.label}
                            {disabled ? <span className="text-xs font-normal text-ink-3">Not configured</span> : null}
                          </label>
                        );
                      })}
                    </div>
                    {props.channels.some((item) => !item.available && item.reason) ? (
                      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-3">
                        {props.channels
                          .filter((item) => !item.available && item.reason)
                          .map((item) => (
                            <li key={item.id}>
                              {item.label}: {item.reason}
                            </li>
                          ))}
                      </ul>
                    ) : null}
                  </fieldset>
                  {channel !== "qr" ? (
                    <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
                      Customers (CSV)
                      <input
                        name="csv"
                        type="file"
                        accept=".csv,text/csv"
                        required
                        className="block w-full text-[13px] text-ink file:mr-3 file:h-8 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:text-[13px] file:font-medium file:text-ink hover:file:bg-paper"
                      />
                      <span className="font-normal text-ink-3">
                        Header: name, phone or email, store code. One file, up to 500 rows. Rows are checked when you save, before anything is sent.
                      </span>
                    </label>
                  ) : (
                    <p className="text-xs text-ink-3">
                      In-store QR campaigns have no recipient list. Each chosen location gets its own code; a scan opens that location’s page.
                    </p>
                  )}
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1.5 flex w-full flex-wrap items-center justify-between gap-2 text-xs font-medium text-ink-2">
                      <span>
                        Locations <span className="font-normal text-ink-3">· {locations.length} selected</span>
                      </span>
                      <span className="flex gap-2 font-normal">
                        <button
                          type="button"
                          className="text-brand hover:text-brand-hover"
                          onClick={() => setLocations(Array.from(new Set([...locations, ...locationChoices.map((location) => location.id)])))}
                        >
                          Select {needle ? "matching" : "all"}
                        </button>
                        {locations.length > 0 ? (
                          <button type="button" className="text-ink-3 hover:text-ink" onClick={() => setLocations([])}>
                            Clear
                          </button>
                        ) : null}
                      </span>
                    </legend>
                    {props.locations.length > 8 ? (
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
                        <Input
                          value={locationQuery}
                          onChange={(event) => setLocationQuery(event.target.value)}
                          placeholder="Search name or store code"
                          aria-label="Search locations"
                          className="h-8 pl-8"
                        />
                      </div>
                    ) : null}
                    <div className="flex max-h-56 flex-col overflow-auto rounded-md border border-line">
                      {locationChoices.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-ink-3">No locations match.</p>
                      ) : (
                        locationChoices.map((location) => (
                          <label
                            key={location.id}
                            className="flex cursor-pointer items-center gap-2.5 border-b border-line-2 px-3 py-2 text-[13px] last:border-0 hover:bg-[#fafbfd]"
                          >
                            <Checkbox
                              checked={locations.includes(location.id)}
                              onCheckedChange={(checked) =>
                                setLocations((current) =>
                                  checked ? [...current, location.id] : current.filter((id) => id !== location.id)
                                )
                              }
                            />
                            <span className="min-w-0 flex-1 truncate text-ink">{location.name}</span>
                            {location.storeCode ? <span className="text-xs text-ink-3">{location.storeCode}</span> : null}
                          </label>
                        ))
                      )}
                    </div>
                  </fieldset>
                </section>

                <section className="flex flex-col gap-4 rounded-lg border border-line bg-white p-4">
                  <h2 className="text-sm font-semibold text-ink">Message</h2>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2 sm:max-w-xs">
                    Page language
                    <select
                      className="h-[34px] rounded-md border border-line bg-white px-2.5 text-[13px] text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line"
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
                    <span className="font-normal text-ink-3">This is the language of the page the customer opens. The message is the text you write.</span>
                  </label>
                  {channel !== "qr" ? (
                    <>
                      <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
                        Message template
                        <Textarea
                          value={template}
                          onChange={(event) => setTemplate(event.target.value)}
                          required
                          maxLength={1000}
                          rows={5}
                        />
                        <span className="font-normal text-ink-3">
                          {"Use {name}, {location}, {link}, and {optout}. An opt-out line is added when it is missing. Don’t ask for “5 stars” or only positive reviews; Google prohibits it."}
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-2 text-[13px] text-ink-2">
                        <input type="checkbox" name="reminder" className="size-4 accent-brand" />
                        Send one reminder if they have not opened the page
                      </label>
                    </>
                  ) : (
                    <p className="text-xs text-ink-3">QR codes don’t send a message. The page language applies to the page a scan opens.</p>
                  )}
                </section>

                <section className="flex flex-col gap-2 rounded-lg border border-dashed border-line bg-white p-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3">
                    <CalendarClock className="size-4" aria-hidden />
                    Schedule
                    <Badge variant="outline">Not available yet</Badge>
                  </h2>
                  <p className="text-xs text-ink-3">Campaigns are sent when you press Send on the review step. Scheduled and batched sends are not available yet.</p>
                </section>

                {selected && !selected.available ? (
                  <p className="text-xs text-ink-3" role="status">
                    {selected.reason}
                  </p>
                ) : null}
                {error ? (
                  <p className="text-xs text-bad" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="ghost" nativeButton={false} render={<Link href={href({})} />}>
                    Back
                  </Button>
                  <Button
                    type="submit"
                    loading={pending}
                    disabled={!selected?.available || locations.length === 0}
                    title={
                      !selected?.available
                        ? "This channel is not configured"
                        : locations.length === 0
                          ? "Select at least one location"
                          : undefined
                    }
                  >
                    Save and review
                  </Button>
                </div>
              </form>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <section className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4">
              <h2 className="text-sm font-semibold text-ink">Summary</h2>
              {(review
                ? [
                    ["Will be sent to", review.channel === "qr" ? "Anyone who scans" : review.preview.eligible.toLocaleString("en-US")],
                    ["Skipped (policy)", (review.preview.suppressed + review.preview.optedOut).toLocaleString("en-US")],
                    ["Can’t be sent", (review.preview.missingContact + review.preview.unknownStore + review.preview.duplicates).toLocaleString("en-US")],
                    ["Channel", channelLabel(review.channel)],
                    ["Language", REQUEST_LANGUAGES.find((item) => item.id === review.language)?.label ?? review.language],
                  ]
                : [
                    ["Channel", channelLabel(channel)],
                    ["Locations", locations.length.toLocaleString("en-US")],
                    ["Language", REQUEST_LANGUAGES.find((item) => item.id === language)?.label ?? language],
                    ["Request limit", `1 per customer every ${props.policyDays} days`],
                  ]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-xs text-ink-3">{label}</span>
                  <span className="text-right font-medium tabular-nums text-ink">{value}</span>
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4">
              <h2 className="text-sm font-semibold text-ink">What the customer sees</h2>
              <p className="text-xs text-ink-3">{copy.both}</p>
              <div className="rounded-lg border border-line bg-paper p-3">
                <div className="rounded-md border border-line bg-white p-3">
                  <p className="text-[13px] font-medium text-ink">{copy.question}</p>
                  <p className="mt-3 rounded-md bg-brand px-3 py-2 text-center text-[13px] font-medium text-white">{copy.google}</p>
                  <p className="mt-2 rounded-md border border-line px-3 py-2 text-center text-[13px] font-medium text-ink">{copy.private}</p>
                  <p className="mt-3 text-center text-[11px] text-ink-3">{copy.optOut}</p>
                </div>
              </div>
            </section>

            <RequestsPolicyCard policyDays={props.policyDays} />
          </aside>
        </div>
        {deleteDialog}
      </div>
    );
  }

  return (
    <>
      <CampaignsPanel
        {...props}
        pending={pending}
        error={error}
        openedUnconfirmed={openedUnconfirmed}
        deliveredUnconfirmed={deliveredUnconfirmed}
        continueHref={(id) => href({ campaign: id })}
        newHref={href({ tab: "new" })}
        qrHref={href({ tab: "qr" })}
        onDelete={setConfirmDelete}
      />
      {deleteDialog}
    </>
  );
}

function CampaignsPanel(
  props: RequestBoardProps & {
    pending: boolean;
    error: string | null;
    openedUnconfirmed: boolean;
    deliveredUnconfirmed: boolean;
    continueHref: (id: string) => string;
    newHref: string;
    qrHref: string;
    onDelete: (campaign: CampaignSummary) => void;
  }
) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      props.campaigns.filter((campaign) => {
        if (needle && !campaign.name.toLowerCase().includes(needle)) return false;
        if (status && campaign.status !== status) return false;
        if (channel && campaign.channel !== channel) return false;
        return true;
      }),
    [props.campaigns, needle, status, channel]
  );
  const statuses = Array.from(new Set(props.campaigns.map((campaign) => campaign.status)));
  const channels = Array.from(new Set(props.campaigns.map((campaign) => campaign.channel)));
  const filtered = Boolean(needle || status || channel);
  const feedbackTotal = Object.values(props.qrByLocation).reduce((sum, qr) => sum + qr.feedback, 0);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search campaigns"
                aria-label="Search campaigns"
                className="h-8 w-full pl-8 sm:w-56"
              />
            </div>
            {statuses.length > 1 ? (
              <SelectField
                label="Filter by status"
                size="sm"
                value={status}
                onValueChange={setStatus}
                className="w-auto"
                options={[
                  { value: "", label: "All statuses" },
                  ...statuses.map((value) => ({ value, label: value === "ready" ? "Active / ready" : value.charAt(0).toUpperCase() + value.slice(1) })),
                ]}
              />
            ) : null}
            {channels.length > 1 ? (
              <SelectField
                label="Filter by channel"
                size="sm"
                value={channel}
                onValueChange={setChannel}
                className="w-auto"
                options={[{ value: "", label: "All channels" }, ...channels.map((value) => ({ value, label: channelLabel(value) }))]}
              />
            ) : null}
          </div>
          <span className="text-xs text-ink-3">
            {filtered ? `${rows.length} of ${props.campaigns.length}` : `${props.campaigns.length}`} {props.campaigns.length === 1 ? "campaign" : "campaigns"} · newest first
          </span>
        </div>
        {props.error ? (
          <p className="border-b border-line px-4 py-2 text-xs text-bad" role="alert">
            {props.error}
          </p>
        ) : null}

        {props.campaigns.length === 0 ? (
          <EmptyState
            bare
            icon={Send}
            title="No campaigns yet"
            description="Start with an in-store QR code, or upload a customer list to send by WhatsApp, SMS or email."
          >
            {props.canManage ? (
              <Button nativeButton={false} render={<Link href={props.newHref} />}>
                New campaign
              </Button>
            ) : (
              <span className="text-xs text-ink-3">An owner or admin can create campaigns.</span>
            )}
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState bare icon={Search} title="No campaigns match" description="Try another name, status or channel.">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setStatus("");
                setChannel("");
              }}
            >
              Clear filters
            </Button>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-[13px]">
              <thead className="bg-[#fafbfc] text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 text-right font-medium">Locations</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Sent</th>
                  <th className="px-3 py-2 text-right font-medium">Delivered</th>
                  <th className="px-3 py-2 text-right font-medium">Opened</th>
                  <th className="px-3 py-2 text-right font-medium" title="Google does not say which review came from a request">
                    New reviews
                  </th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((campaign) => {
                  const state = campaignStatus(campaign);
                  const isQr = campaign.channel === "qr";
                  const isDraft = campaign.status === "draft";
                  return (
                    <tr key={campaign.id} className="border-b border-line-2 align-top last:border-0 hover:bg-[#fafbfd]">
                      <td className="px-3 py-2.5">
                        {isDraft && props.canManage ? (
                          <Link href={props.continueHref(campaign.id)} className="font-semibold text-ink hover:text-brand">
                            {campaign.name}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink">{campaign.name}</span>
                        )}
                        <span className="block text-xs text-ink-3">
                          {campaign.source === "qr" ? "QR codes" : "CSV upload"}
                          {" · "}
                          {REQUEST_LANGUAGES.find((item) => item.id === campaign.language)?.label ?? campaign.language}
                          {isDraft ? ` · ${campaign.preview.eligible.toLocaleString("en-US")} ready` : ""}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{isQr ? "In store" : channelLabel(campaign.channel)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{campaign.locations}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">
                        {formatDay(campaign.sentAt ?? campaign.createdAt)}
                        <span className="block text-xs text-ink-3">{campaign.sentAt ? "Sent" : "Created"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                        {isQr ? "—" : isDraft ? <span className="text-ink-3">Not sent</span> : campaign.sent.toLocaleString("en-US")}
                        {campaign.queued > 0 ? <span className="block text-xs text-info">{campaign.queued} still queued</span> : null}
                        {campaign.failed > 0 ? <span className="block text-xs text-bad">{campaign.failed} failed</span> : null}
                        {campaign.unavailable > 0 ? <span className="block text-xs text-ink-3">{campaign.unavailable} unavailable</span> : null}
                        {campaign.suppressed > 0 ? <span className="block text-xs text-ink-3">{campaign.suppressed} skipped by limit</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                        {isQr || isDraft ? "—" : props.deliveredUnconfirmed ? <span className="text-xs text-ink-3">Not confirmed</span> : campaign.delivered.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                        {isQr || isDraft ? "—" : props.openedUnconfirmed ? <span className="text-xs text-ink-3">Not confirmed</span> : campaign.opened.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-ink-3">Not available</td>
                      <td className="px-3 py-2.5">
                        <Badge variant={state.variant}>{state.label}</Badge>
                        {campaign.lastError ? <span className="mt-1 block max-w-[16rem] whitespace-normal text-xs text-bad">{campaign.lastError}</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isDraft && props.canManage ? (
                            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={props.continueHref(campaign.id)} />}>
                              Continue
                            </Button>
                          ) : null}
                          {isQr ? (
                            <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={props.qrHref} />}>
                              Codes
                            </Button>
                          ) : null}
                          {props.canManage ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={<Button size="icon-sm" variant="ghost" aria-label={`More actions for ${campaign.name}`} />}
                                disabled={props.pending}
                              >
                                <MoreHorizontal aria-hidden />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem variant="destructive" onClick={() => props.onDelete(campaign)}>
                                  <Trash2 aria-hidden />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
          Delivery status is shown per campaign. A per-recipient delivery log is not available yet.
        </p>
      </section>

      <aside className="flex flex-col gap-4">
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Inbox className="size-4 text-ink-3" aria-hidden />
            Private feedback
          </h2>
          <p className="text-[13px] text-ink">
            <span className="font-semibold tabular-nums">{props.metrics.find((metric) => metric.id === "feedback")?.value ?? "0"}</span>{" "}
            <span className="text-ink-3">notes in this workspace</span>
            {feedbackTotal > 0 ? <span className="text-ink-3"> · {feedbackTotal.toLocaleString("en-US")} from QR codes in this scope</span> : null}
          </p>
          <p className="text-xs text-ink-3">
            Notes customers leave on the request page stay with the business and are never posted on Google. Reading notes here is not available
            yet.
          </p>
        </section>
        <RequestsPolicyCard policyDays={props.policyDays} />
      </aside>
    </div>
  );
}

function QrPanel(props: RequestBoardProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? props.locations.filter(
        (location) => location.name.toLowerCase().includes(needle) || (location.storeCode ?? "").toLowerCase().includes(needle)
      )
    : props.locations;
  const pages = Math.max(1, Math.ceil(rows.length / QR_PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * QR_PAGE_SIZE, current * QR_PAGE_SIZE);
  const totals = Object.values(props.qrByLocation).reduce(
    (sum, qr) => ({ scans: sum.scans + qr.scans, feedback: sum.feedback + qr.feedback }),
    { scans: 0, feedback: 0 }
  );
  const downloadAll = props.clientId ? `/api/requests/qr?format=pdf&client=${props.clientId}` : "/api/requests/qr?format=pdf";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              QR codes · {props.locations.length} {props.locations.length === 1 ? "location" : "locations"}
            </h2>
            <p className="mt-0.5 text-xs text-ink-3">
              {totals.scans.toLocaleString("en-US")} scans · {totals.feedback.toLocaleString("en-US")} private notes. A scan opens that location’s
              page; a scan is not a Google review.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {props.locations.length > 8 ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search locations"
                  aria-label="Search locations"
                  className="h-8 w-full pl-8 sm:w-48"
                />
              </div>
            ) : null}
            <Button size="sm" nativeButton={false} render={<a href={downloadAll} />}>
              <Download aria-hidden />
              Download all (PDF)
            </Button>
          </div>
        </div>
        {visible.length === 0 ? (
          <EmptyState bare icon={QrCode} title="No locations match" description="Try another name or store code.">
            <Button variant="outline" size="sm" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-[13px]">
              <thead className="bg-[#fafbfc] text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 text-right font-medium">Scans</th>
                  <th className="px-3 py-2 text-right font-medium">Private notes</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((location) => {
                  const qr = props.qrByLocation[location.id];
                  return (
                    <tr key={location.id} className="border-b border-line-2 last:border-0 hover:bg-[#fafbfd]">
                      <td className="px-3 py-2">
                        {qr ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/requests/qr/${location.id}?format=svg`}
                            alt={`QR code for ${location.name}`}
                            width={56}
                            height={56}
                            loading="lazy"
                            className="size-14 rounded border border-line bg-white"
                          />
                        ) : (
                          <span className="inline-flex size-14 items-center justify-center rounded border border-dashed border-line text-[11px] text-ink-3">
                            Preparing
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-ink">{location.name}</span>
                        <span className="block text-xs text-ink-3">
                          {location.storeCode ? `${location.storeCode} · ` : ""}
                          {location.url ? "Google button on the page" : (
                            <span className="text-warn">No Google place ID · page shows private feedback only</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{qr ? qr.scans.toLocaleString("en-US") : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-2">{qr ? qr.feedback.toLocaleString("en-US") : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {qr ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="outline" nativeButton={false} render={<a href={`/api/requests/qr/${location.id}?format=pdf`} />}>
                              <FileText aria-hidden />
                              Counter card
                            </Button>
                            <Button size="sm" variant="ghost" nativeButton={false} render={<a href={`/api/requests/qr/${location.id}?format=svg`} download />}>
                              SVG
                            </Button>
                            <Button size="sm" variant="ghost" nativeButton={false} render={<a href={qr.url} target="_blank" rel="noreferrer" />}>
                              Preview page
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-3">Preparing the code</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > QR_PAGE_SIZE ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5 text-xs text-ink-3">
            <span>
              {(current - 1) * QR_PAGE_SIZE + 1}–{Math.min(current * QR_PAGE_SIZE, rows.length)} of {rows.length}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={current >= pages} onClick={() => setPage(current + 1)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>
      <aside className="flex flex-col gap-4">
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-ink">About these codes</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-ink-3">
            <li>Each code is unique to its location, so scans are counted per location.</li>
            <li>The counter card is a printable PDF with the code and a short invitation.</li>
            <li>Codes are created automatically for every location in scope. Regenerating a code is not available yet.</li>
          </ul>
        </section>
        <RequestsPolicyCard policyDays={props.policyDays} />
      </aside>
    </div>
  );
}
