import { cn } from "@/lib/utils";

/** Two-letter mark for the location/business the request came from. */
export function customerInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

/** Large touch targets for customer pages (48–52px). */
export function customerButton(kind: "primary" | "outline") {
  return cn(
    "inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] px-4 py-3 text-base font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-line",
    kind === "primary"
      ? "border border-brand bg-brand text-white hover:bg-brand-hover"
      : "border border-line bg-white text-ink hover:bg-paper"
  );
}

/**
 * Mobile-first (390px) customer frame: brand strip, centred column, quiet footer.
 * `muted` greys the strip for dead links.
 */
export function CustomerFrame({
  children,
  footer,
  muted = false,
  lang,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  muted?: boolean;
  lang?: string;
}) {
  return (
    <div lang={lang} className="flex min-h-dvh justify-center bg-paper text-[15px] text-ink">
      <div className="flex w-full max-w-[480px] flex-col bg-white sm:my-8 sm:min-h-0 sm:rounded-xl sm:border sm:border-line sm:overflow-hidden">
        <div aria-hidden className={cn("h-1.5 shrink-0", muted ? "bg-ink-3" : "bg-brand")} />
        <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-8 text-center">{children}</main>
        <footer className="flex flex-col gap-1.5 border-t border-line px-6 py-4 text-center text-[13px] text-ink-3">
          {footer}
          <span>
            <a href="/privacy" className="text-ink-3 underline-offset-2 hover:underline">
              Privacy
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}
