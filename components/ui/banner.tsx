import { AlertTriangle, CheckCircle2, Info, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type BannerTone = "info" | "warn" | "bad" | "ok" | "ai" | "neutral";

const TONE: Record<BannerTone, string> = {
  info: "border-info-line bg-info-tint text-[#0b5a6f]",
  warn: "border-warn-line bg-warn-tint text-[#7c3a06]",
  bad: "border-bad-line bg-bad-tint text-[#9b1c1c]",
  ok: "border-ok-line bg-ok-tint text-[#166534]",
  ai: "border-ai-line bg-ai-tint text-[#5b21b6]",
  neutral: "border-line bg-white text-ink-2",
};

const ICON = { info: Info, warn: AlertTriangle, bad: XCircle, ok: CheckCircle2, ai: Sparkles, neutral: Info };

/**
 * Explain, then offer a recovery. `title` is the bold lead; children the detail;
 * `actions` sit on the right (wrap below on narrow screens).
 */
export function Banner({
  tone = "info",
  title,
  children,
  actions,
  icon = true,
  className,
  role,
}: {
  tone?: BannerTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: boolean;
  className?: string;
  role?: "status" | "alert";
}) {
  const Icon = ICON[tone];
  return (
    <div
      role={role ?? (tone === "bad" ? "alert" : "status")}
      className={cn("flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-lg border px-3 py-2.5 text-[13px]", TONE[tone], className)}
    >
      {icon ? <Icon className="mt-px size-4 shrink-0" aria-hidden /> : null}
      <div className="min-w-0 flex-1 leading-relaxed">
        {title ? <span className="font-semibold">{title}</span> : null}
        {title && children ? " " : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
