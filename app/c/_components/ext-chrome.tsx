import Link from "next/link";
import { PubLogo } from "@/components/pub-shell";
import { cn } from "@/lib/utils";

/** Two-letter mark for the business named on an external link. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

export function BusinessMark({ name, size = "md" }: { name: string | null; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-bold text-white",
        name ? "bg-brand" : "bg-ink-3",
        size === "sm" ? "size-5 rounded-[5px] text-[9px]" : "size-[26px] rounded-[7px] text-[11px]"
      )}
    >
      {name ? initials(name) : ""}
    </span>
  );
}

/** External page frame: business branding on the left, a quiet note on the right. */
export function ExtPage({
  name,
  note,
  children,
}: {
  name: string | null;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-[15px] text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
          {name ? (
            <span className="flex min-w-0 items-center gap-2.5">
              <BusinessMark name={name} />
              <b className="truncate font-semibold">{name}</b>
            </span>
          ) : (
            <PubLogo />
          )}
          {note ? <span className="text-[13px] text-ink-3">{note}</span> : null}
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center px-4 py-10 sm:pt-12">{children}</main>
      <footer className="px-4 pb-8 text-center text-[13px] text-ink-3">
        Powered by RevuPilot ·{" "}
        <Link href="/privacy" className="hover:text-ink">
          Privacy
        </Link>{" "}
        ·{" "}
        <Link href="/terms" className="hover:text-ink">
          Terms
        </Link>
      </footer>
    </div>
  );
}

export function ExtSideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-white p-4">
      <b className="text-sm font-semibold text-ink">{title}</b>
      <div className="text-[13px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}
