import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { pageCopy } from "@/lib/review-requests";
import { openPublicRequest } from "@/lib/services/request-campaigns";
import { Banner } from "@/components/ui/banner";
import { GoogleMark } from "@/components/google-mark";
import { OrDivider } from "@/components/pub-shell";
import { cn } from "@/lib/utils";
import { CustomerFrame, customerButton, customerInitials } from "../_components/customer-frame";

export const dynamic = "force-dynamic";

interface PublicRequestPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Customer review-request page. Every visitor sees the same Google option in the
 * same place, whatever they say privately: no rating gate, no sentiment branching.
 */
export default async function PublicRequestPage({ params, searchParams }: PublicRequestPageProps) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const page = await openPublicRequest(token);
  if (!page) notFound();
  const copy = pageCopy(page.language, page.locationName);
  const sent = query.sent === "1";
  const retry = query.sent === "0";
  const stopped = query.stopped === "1";
  const qrStop = query.stopped === "qr";
  const hasGoogle = Boolean(page.googleUrl);

  return (
    <CustomerFrame
      lang={page.language}
      footer={
        <>
          <span>
            {page.locationName} · RevuPilot ·{" "}
            <a href="#stop" className="text-ink-3 underline-offset-2 hover:underline">
              {copy.optOut}
            </a>
          </span>
          <span>{page.model.both}</span>
        </>
      }
    >
      {sent ? (
        <span className="inline-flex size-16 items-center justify-center rounded-full bg-ok-tint text-ok">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>
      ) : (
        <span
          aria-hidden
          className="inline-flex size-14 items-center justify-center rounded-[14px] bg-brand text-xl font-bold text-white"
        >
          {customerInitials(page.locationName)}
        </span>
      )}

      <div className="flex flex-col gap-2">
        {!sent ? <p className="text-sm text-ink-3">{page.locationName}</p> : null}
        <h1 className={sent ? "text-xl font-semibold leading-snug text-ink" : "text-2xl font-semibold leading-snug tracking-[-0.01em] text-ink"}>
          {sent ? copy.thanks : page.model.question}
        </h1>
      </div>

      {stopped ? (
        <Banner tone="ok" className="w-full text-left text-sm">
          {copy.stopped}
        </Banner>
      ) : null}
      {qrStop ? (
        <Banner tone="neutral" className="w-full text-left text-sm">
          This code is not tied to a phone or email, so there is no message to stop.
        </Banner>
      ) : null}

      {hasGoogle ? (
        <a href={`/r/${token}/google`} className={customerButton("primary")}>
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-white">
            <GoogleMark className="size-4" />
          </span>
          {page.model.googleLabel}
        </a>
      ) : (
        <Banner tone="warn" className="w-full text-left text-sm">
          {copy.missingPlace}
        </Banner>
      )}

      <OrDivider />

      <details
        className="group w-full text-left"
        open={!hasGoogle || retry || undefined}
      >
        <summary className={cn(customerButton(hasGoogle ? "outline" : "primary"), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
          {page.model.privateLabel}
        </summary>
        <form action={`/r/${token}/feedback`} method="post" className="mt-3 flex flex-col gap-3">
          <label htmlFor="feedback-body" className="sr-only">
            {page.model.privateLabel}
          </label>
          <textarea
            id="feedback-body"
            name="body"
            required
            maxLength={2000}
            rows={5}
            placeholder={copy.placeholder}
            aria-invalid={retry || undefined}
            className="min-h-[120px] w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base text-ink outline-none placeholder:text-stone focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line aria-invalid:border-bad"
          />
          <button type="submit" className={customerButton("primary")}>
            {copy.submit}
          </button>
        </form>
      </details>

      <form id="stop" action={`/r/${token}/opt-out`} method="post">
        <button type="submit" className="text-sm text-ink-3 underline underline-offset-2 hover:text-ink">
          {copy.optOut}
        </button>
      </form>
    </CustomerFrame>
  );
}
