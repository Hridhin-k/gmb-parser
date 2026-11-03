import Link from "next/link";
import type { ReactNode } from "react";
import { SettingsToggle } from "@/components/settings-toggle";
import { cn } from "@/lib/utils";

/** The white settings card: title, one-line description, and an "Applies to" picker or a primary action. */
export function SettingsSection({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-white" aria-labelledby="settings-section-title">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5 sm:px-6">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
          <h2 id="settings-section-title" className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <p className="text-sm leading-normal text-ink-2">{description}</p>
        </div>
        {aside ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children ? <ul className="m-0 list-none p-0">{children}</ul> : null}
    </section>
  );
}

function RowText({ label, hint }: { label: string; hint?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-[1_1_280px] flex-col gap-[3px]">
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint ? <span className="text-[13px] leading-snug text-ink-3">{hint}</span> : null}
    </span>
  );
}

const ROW = "flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line-2 px-5 py-[18px] sm:px-6";

/** Label and hint on the left; the current value and one action on the right. */
export function SettingsValueRow({
  label,
  hint,
  value,
  action,
}: {
  label: string;
  hint?: ReactNode;
  value: ReactNode;
  action?: { label: string; href: string } | null;
}) {
  return (
    <li className={ROW}>
      <RowText label={label} hint={hint} />
      <span className="flex min-w-0 items-center gap-3">
        <span className="min-w-0 text-right text-sm text-ink [overflow-wrap:anywhere]">{value}</span>
        {action ? (
          <Link href={action.href} className="shrink-0 px-1 py-2 text-[13px] font-medium text-brand hover:text-brand-hover">
            {action.label}
          </Link>
        ) : null}
      </span>
    </li>
  );
}

/** A switch that saves straight away. */
export function SettingsToggleRow({
  label,
  hint,
  ...toggle
}: {
  label: string;
  hint?: ReactNode;
  on: boolean;
  endpoint: string;
  bodies: { on: object; off: object };
  disabled?: boolean;
}) {
  return (
    <li className={ROW}>
      <RowText label={label} hint={hint} />
      <SettingsToggle label={label} {...toggle} />
    </li>
  );
}

/** The full editor for a section, under its summary card. */
export function SettingsDetail({ id, title, children, className }: { id: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} className={cn("min-w-0 scroll-mt-20 space-y-3", className)}>
      {title ? <h3 className="text-[15px] font-semibold text-ink">{title}</h3> : null}
      {children}
    </div>
  );
}

/** Primary pill action in a section header, as on the board. */
export function SettingsAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center rounded-full bg-ink px-[18px] text-sm font-semibold text-white outline-none hover:bg-ink-2 focus-visible:ring-2 focus-visible:ring-brand-line"
    >
      {children}
    </Link>
  );
}
