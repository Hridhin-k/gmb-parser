import { CustomerFrame, customerButton } from "../_components/customer-frame";

/** Shown when a review-request link is invalid, mistyped or no longer active. */
export default function RequestLinkNotFound() {
  return (
    <CustomerFrame muted footer={<span>Powered by RevuPilot</span>}>
      <span
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-xl border border-line bg-paper text-lg font-bold text-ink-3"
      >
        ?
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold leading-snug tracking-[-0.01em] text-ink">This link isn&apos;t valid any more</h1>
        <p className="text-[15px] leading-relaxed text-ink-3">It may have expired, been switched off, or been mistyped.</p>
      </div>
      <div className="flex w-full flex-col gap-2.5 rounded-xl border border-line p-4 text-left">
        <b className="text-sm font-semibold">Still want to leave a review?</b>
        <p className="text-[13px] leading-relaxed text-ink-3">
          Search for the business on Google Maps and tap &ldquo;Write a review&rdquo;, or use the QR code displayed in store.
        </p>
        <a href="https://www.google.com/maps" rel="noopener noreferrer" className={customerButton("outline")}>
          Open Google Maps
        </a>
      </div>
    </CustomerFrame>
  );
}
