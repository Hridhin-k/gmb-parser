"use client";

import { useState } from "react";
import { AlertTriangle, Check, Download, Printer } from "lucide-react";
import { useCopyText } from "@/components/copy-review-link";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ShareLocation {
  id: string;
  name: string;
  businessName: string;
  /** Google's own review link when the location has a place ID. */
  googleUrl: string | null;
  /** The RevuPilot request page; also what the QR code opens. */
  pageUrl: string | null;
}

const PILL =
  "inline-flex items-center justify-center gap-2 rounded-full border text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-line";

function shareLink(location: ShareLocation): string | null {
  return location.googleUrl ?? location.pageUrl;
}

function displayLink(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function readyMessages(location: ShareLocation, link: string) {
  return [
    {
      kind: "Text message",
      body: `Hi {first name}, thanks for visiting ${location.businessName} today. Would you mind leaving a quick review? It really helps.\n${link}`,
    },
    {
      kind: "Email",
      body: `Subject: How was your visit?\n\nHi {first name},\nThanks for choosing us. If you have a minute, a short Google review helps other customers find us.\n${link}`,
    },
  ];
}

function CopyFallback({ text, label }: { text: string; label: string }) {
  return (
    <label className="block text-xs text-ink-3">
      {label}
      <Input readOnly value={text} className="mt-1" onFocus={(event) => event.currentTarget.select()} />
    </label>
  );
}

function MessageCard({ kind, body }: { kind: string; body: string }) {
  const { state, copy } = useCopyText();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{kind}</h3>
        <button
          type="button"
          onClick={() => void copy(body)}
          className="inline-flex items-center gap-1 rounded-md px-1 py-1.5 text-[13px] font-medium text-brand outline-none hover:text-brand-hover focus-visible:ring-2 focus-visible:ring-brand-line"
        >
          {state === "copied" ? <Check className="size-3.5" aria-hidden /> : null}
          {state === "copied" ? "Copied" : "Copy text"}
        </button>
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{body}</p>
      {state === "failed" ? <CopyFallback text={body} label="Copy this message" /> : null}
    </div>
  );
}

/** The everyday Get reviews view: pick a location, share its link, QR code or a ready-made message. */
export function GetReviewsShare({ locations, initialId }: { locations: ShareLocation[]; initialId?: string | null }) {
  const [selectedId, setSelectedId] = useState(
    locations.some((location) => location.id === initialId) ? (initialId as string) : (locations[0]?.id ?? "")
  );
  const { state, copy, reset } = useCopyText();
  const current = locations.find((location) => location.id === selectedId) ?? locations[0];
  if (!current) return null;
  const link = shareLink(current);
  const withoutGoogle = locations.filter((location) => !location.googleUrl);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-center gap-7 rounded-xl border border-line bg-white p-5 sm:p-6">
        <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
            Location
            <select
              value={current.id}
              onChange={(event) => {
                setSelectedId(event.target.value);
                reset();
              }}
              className="h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-sm font-normal text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line"
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink" id="review-link-label">
              Review link
            </span>
            {link ? (
              <div className="flex flex-wrap gap-2">
                <span
                  aria-labelledby="review-link-label"
                  className="flex h-11 min-w-0 flex-[1_1_260px] items-center truncate rounded-lg bg-paper px-3.5 text-sm text-ink-2"
                  title={link}
                >
                  <span className="truncate">{displayLink(link)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void copy(link)}
                  className={cn(PILL, "h-11 min-w-[120px] flex-[1_0_auto] border-ink bg-ink px-[18px] text-sm font-semibold text-white hover:bg-ink-2 sm:flex-none")}
                >
                  {state === "copied" ? <Check className="size-4" aria-hidden /> : null}
                  {state === "copied" ? "Copied" : "Copy link"}
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">The link for this location is still being prepared. Reload in a moment.</p>
            )}
            {state === "failed" && link ? <CopyFallback text={link} label="Copy this link" /> : null}
          </div>

          {current.pageUrl ? (
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/requests/qr/${current.id}?format=pdf&inline=1`}
                target="_blank"
                rel="noreferrer"
                className={cn(PILL, "h-10 border-line bg-white px-4 text-ink hover:bg-paper")}
              >
                <Printer className="size-[15px]" aria-hidden />
                Print a counter card
              </a>
              <a
                href={`/api/requests/qr/${current.id}?format=svg`}
                download={`review-qr-${current.id.slice(0, 8)}.svg`}
                className={cn(PILL, "h-10 border-line bg-white px-4 text-ink hover:bg-paper")}
              >
                <Download className="size-[15px]" aria-hidden />
                Download QR code
              </a>
            </div>
          ) : null}
        </div>

        <div className="flex flex-[1_1_180px] flex-col items-center gap-2">
          {current.pageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={current.id}
              src={`/api/requests/qr/${current.id}?format=svg`}
              alt={`QR code for ${current.name}`}
              width={168}
              height={168}
              className="size-[168px] rounded-xl border border-line bg-white p-2"
            />
          ) : (
            <div
              role="img"
              aria-label="QR code is being prepared"
              className="flex size-[168px] items-center justify-center rounded-xl border border-dashed border-line bg-paper text-[13px] text-ink-3"
            >
              Preparing
            </div>
          )}
          <span className="text-center text-xs text-ink-3">Scans open this location’s review page</span>
        </div>
      </section>

      {link ? (
        <section className="flex flex-col gap-3" aria-labelledby="ready-messages">
          <h2 id="ready-messages" className="text-[15px] font-semibold text-ink">
            Ready-made messages
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
            {readyMessages(current, link).map((message) => (
              <MessageCard key={`${current.id}-${message.kind}`} kind={message.kind} body={message.body} />
            ))}
          </div>
        </section>
      ) : null}

      {withoutGoogle.length > 0 ? (
        <section
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warn-line bg-warn-tint px-5 py-4 text-sm leading-normal text-warn"
        >
          <AlertTriangle className="mt-0.5 size-[18px] shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {withoutGoogle.length === 1 ? (
              <>
                <strong className="font-semibold">{withoutGoogle[0].name}</strong> has no direct Google link yet, so its link opens
                your RevuPilot request page instead. It still works.
              </>
            ) : (
              <>
                <strong className="font-semibold">
                  {withoutGoogle.length.toLocaleString("en-US")} locations
                </strong>{" "}
                have no direct Google link yet ({withoutGoogle.slice(0, 3).map((location) => location.name).join(", ")}
                {withoutGoogle.length > 3 ? ", …" : ""}), so their links open your RevuPilot request page instead. They still work.
              </>
            )}
          </span>
        </section>
      ) : null}
    </div>
  );
}
