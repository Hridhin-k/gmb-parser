import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
  /** Render without its own card (inside an existing panel). */
  bare?: boolean;
  tone?: "default" | "bad";
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, children, bare, tone = "default", className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        !bare && "rounded-lg border border-line bg-white",
        className
      )}
    >
      {Icon ? <Icon className="size-8 text-[#aeb6c2]" strokeWidth={1.25} aria-hidden /> : null}
      <h3 className={cn("text-[15px] font-semibold", tone === "bad" ? "text-bad" : "text-ink")}>{title}</h3>
      <div className="max-w-md text-[13px] leading-relaxed text-ink-3">{description}</div>
      {children ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}
