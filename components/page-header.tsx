import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  /** One line under the title: what this page covers (scope, period). */
  description?: React.ReactNode;
  /** Shown only for nested pages (Business › Location, Escalation #). */
  breadcrumbs?: Crumb[];
  /** Small status row above the title (tags). */
  eyebrow?: React.ReactNode;
  /** Actions. Put the single primary action last. */
  children?: React.ReactNode;
  className?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
          {index > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-ink">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-ink" aria-current="page">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ title, description, breadcrumbs, eyebrow, children, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 flex flex-wrap items-center gap-1.5">{eyebrow}</div> : null}
          <h1 className="text-xl font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-[13px] text-ink-3">{description}</p> : null}
        </div>
        {children ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

export interface PageTab {
  label: string;
  href: string;
  active?: boolean;
  count?: number | string | null;
  tone?: "default" | "bad";
}

/** Contextual tabs: split one destination without adding sidebar items. */
export function PageTabs({ tabs, className, children }: { tabs: PageTab[]; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-end gap-1 border-b border-line", className)}>
      <nav className="-mb-px flex flex-wrap gap-1" aria-label="Sections">
        {tabs.map((tab) => (
          <Link
            key={tab.href + tab.label}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              tab.active ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink"
            )}
          >
            {tab.label}
            {tab.count != null && tab.count !== "" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] tabular-nums",
                  tab.tone === "bad" ? "bg-bad-tint text-bad" : "bg-paper text-ink-2"
                )}
              >
                {typeof tab.count === "number" ? tab.count.toLocaleString("en-US") : tab.count}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
      {children ? <div className="ml-auto flex items-center gap-2 pb-1.5">{children}</div> : null}
    </div>
  );
}
