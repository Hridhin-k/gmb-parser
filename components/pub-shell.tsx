import Link from "next/link";
import { cn } from "@/lib/utils";

/** Shared chrome for public, account-access and external pages (15px body). */

export function PubLogo({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2 font-bold tracking-[-0.01em] text-ink",
        size === "sm" ? "text-sm" : "text-base",
        className
      )}
      aria-label="RevuPilot home"
    >
      <span aria-hidden className={cn("inline-block rounded-[7px] bg-brand", size === "sm" ? "size-[18px] rounded-[5px]" : "size-[26px]")} />
      RevuPilot
    </Link>
  );
}

/** 64px white top bar. `links` sit after the logo (hidden on small screens); `children` on the right. */
export function PubNav({
  links,
  children,
  className,
}: {
  links?: Array<{ href: string; label: string }>;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("border-b border-line bg-white", className)}>
      <nav
        aria-label="Main"
        className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-8"
      >
        <PubLogo />
        {links?.length ? (
          <span className="hidden items-center gap-6 md:flex">
            {links.map((link) => (
              <a key={link.href} href={link.href} className="text-[15px] font-medium text-ink-2 hover:text-ink">
                {link.label}
              </a>
            ))}
          </span>
        ) : null}
        <span className="flex-1" />
        {children ? <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">{children}</div> : null}
      </nav>
    </header>
  );
}

/** Full-height public page on the paper ground. */
export function PubPage({ children, nav, className }: { children: React.ReactNode; nav?: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-[15px] text-ink">
      {nav}
      <main className={cn("flex flex-1 flex-col items-center px-4 py-10 sm:py-12", className)}>{children}</main>
    </div>
  );
}

/** Centred 420px auth card (wider via className when a board calls for it). */
export function AuthCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full max-w-[420px] flex-col gap-4 rounded-xl border border-line bg-white p-6 sm:p-8", className)}>
      {children}
    </div>
  );
}

/** Amber dashed "Demo" marker. */
export function DemoTag({ children = "Demo" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center rounded-sm border border-dashed border-[#f59e0b] bg-demo px-2 text-xs font-semibold text-demo-ink">
      {children}
    </span>
  );
}

/** Small grey tag naming the signed-in identity that was checked. */
export function IdentityTag({ email, suffix }: { email: string; suffix?: string }) {
  return (
    <span className="inline-flex h-[22px] w-fit max-w-full items-center gap-1.5 truncate rounded-sm bg-paper px-2 text-xs font-medium text-ink-2">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">
        Signed in as {email}
        {suffix ? ` · ${suffix}` : null}
      </span>
    </span>
  );
}

/** "or" divider used between the Google path and the alternative path. */
export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5" role="separator">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Classes for the white Google-style button (`.gbtn` in the boards). */
export const googleButtonClass =
  "inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink outline-none transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:opacity-60";

export function PubFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-6 text-[13px] text-ink-3 sm:px-8">
        <PubLogo size="sm" />
        <nav aria-label="Legal" className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
        </nav>
        <span>© {new Date().getFullYear()} RevuPilot</span>
      </div>
    </footer>
  );
}
