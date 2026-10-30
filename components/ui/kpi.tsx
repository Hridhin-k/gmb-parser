import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Compact metric tile. Every metric should lead somewhere: pass `href` to the
 * filtered list that produced the number.
 */
export function KpiTile({
  label,
  value,
  detail,
  href,
  tone,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  href?: string;
  tone?: "bad" | "warn" | "ok" | "ai";
  className?: string;
}) {
  const body = (
    <>
      <span className="text-xs text-ink-3">{label}</span>
      <span
        className={cn(
          "text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-ink",
          tone === "bad" && "text-bad",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "ai" && "text-ai"
        )}
      >
        {value}
      </span>
      {detail ? <span className="text-xs text-ink-3">{detail}</span> : null}
    </>
  );
  const cls = cn(
    "flex min-w-0 flex-col gap-0.5 rounded-lg border bg-white px-3.5 py-3 text-ink",
    tone === "bad" ? "border-bad-line" : "border-line",
    href && "transition-colors hover:border-brand-line",
    className
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]", className)}>
      {children}
    </div>
  );
}

/** Up/down delta. `goodWhen` says which direction is good. */
export function Delta({
  value,
  suffix = "",
  goodWhen = "up",
  className,
}: {
  value: number | null | undefined;
  suffix?: string;
  goodWhen?: "up" | "down";
  className?: string;
}) {
  if (value == null || Number.isNaN(value)) return null;
  const up = value > 0;
  const flat = value === 0;
  const good = flat ? null : goodWhen === "up" ? up : !up;
  return (
    <span className={cn("tabular-nums", good === true && "text-ok", good === false && "text-bad", className)}>
      {flat ? "=" : up ? "▲" : "▼"} {Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}
      {suffix}
    </span>
  );
}
