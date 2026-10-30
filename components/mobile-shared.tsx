import type { ReactNode } from "react";

export const OFFLINE_MESSAGE =
  "No connection. Nothing was saved or posted. Check your signal and retry.";

/**
 * Action bar that stays above the mobile tab bar while the page scrolls.
 * The tab bar is 56px plus a 1px border plus the device safe area.
 */
export function MobileStickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 -mx-4 mt-2 flex flex-col gap-2 border-t border-line bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      {children}
    </div>
  );
}

/** The customer's words, with the English translation under them when there is one. */
export function MobileReviewQuote({
  original,
  translation,
}: {
  original: string | null;
  translation: string | null;
}) {
  if (!original) {
    return <p className="text-[13px] text-ink-3">This review has no written comment.</p>;
  }
  return (
    <div className="space-y-2 rounded-r-md border-l-[3px] border-star bg-paper px-3 py-2.5">
      {translation ? <p className="text-xs font-semibold text-ink-3">Original</p> : null}
      <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-ink">{original}</p>
      {translation ? (
        <div className="border-t border-dashed border-line pt-2">
          <p className="text-xs font-semibold text-ink-3">English translation</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-6 text-ink-2">{translation}</p>
        </div>
      ) : null}
    </div>
  );
}
