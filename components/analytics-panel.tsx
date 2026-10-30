import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Flat card used by Analytics, Insights and Reports. `flush` drops the body
 * padding so a table can run edge to edge under a bordered header.
 */
export function Panel({
  title,
  hint,
  action,
  children,
  flush,
  footer,
  className,
  id,
  tone,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  footer?: React.ReactNode;
  className?: string;
  id?: string;
  tone?: "bad" | "ok" | "warn" | "ai";
}) {
  return (
    <section
      id={id}
      className={cn(
        "min-w-0 scroll-mt-24 overflow-hidden rounded-lg border bg-white",
        tone === "bad" ? "border-bad-line" : tone === "ok" ? "border-ok-line" : tone === "warn" ? "border-warn-line" : tone === "ai" ? "border-ai-line" : "border-line",
        className
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-2",
          flush ? "border-b border-line px-4 py-3" : "px-4 pt-4"
        )}
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <div className={flush ? "" : "px-4 pb-4 pt-3"}>{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-ink-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** Segmented link control for view options kept in the URL. */
export function Segmented({
  label,
  options,
}: {
  label: string;
  options: Array<{ label: string; href: string; current: boolean }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-3">{label}</span>
      <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-md border border-line bg-white p-0.5">
        {options.map((option) => (
          <Link
            key={option.label}
            href={option.href}
            scroll={false}
            aria-current={option.current ? "true" : undefined}
            className={cn(
              "inline-flex h-7 items-center rounded-[5px] px-2.5 text-xs font-medium transition-colors",
              option.current ? "bg-brand-tint text-brand" : "text-ink-2 hover:bg-paper hover:text-ink"
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Small "nothing here" line inside a panel. */
export function NoData({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-ink-3">{children}</p>;
}
