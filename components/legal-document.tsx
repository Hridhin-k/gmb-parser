import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PubFooter, PubNav } from "@/components/pub-shell";

export function LegalDocument({
  title,
  updated,
  contents,
  children,
}: {
  title: string;
  updated: string;
  /** Section anchors for the contents list; ids must match `<section id>` in children. */
  contents?: Array<{ id: string; label: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-[15px] text-ink">
      <PubNav>
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          Sign in
        </Link>
      </PubNav>
      <div className="mx-auto grid w-full max-w-[1120px] flex-1 items-start gap-10 px-4 py-10 sm:px-8 sm:py-14 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
        {contents?.length ? (
          <aside className="flex flex-col gap-1.5 text-sm lg:sticky lg:top-6">
            <span className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Contents</span>
            <nav aria-label="Contents" className="flex flex-col gap-1.5">
              {contents.map((item, index) => (
                <a key={item.id} href={`#${item.id}`} className="text-ink-2 hover:text-brand">
                  {index + 1}. {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-1.5 rounded-lg border border-line p-3 text-[13px]">
              <span className="text-ink-3">{updated}</span>
              <Link href={title.toLowerCase().includes("privacy") ? "/terms" : "/privacy"} className="text-brand hover:underline">
                {title.toLowerCase().includes("privacy") ? "Terms of Service" : "Privacy Policy"}
              </Link>
            </div>
          </aside>
        ) : null}
        <article className="flex max-w-[720px] flex-col gap-7">
          <div className="flex flex-col gap-2.5">
            <span className="inline-flex h-[22px] w-fit items-center rounded-sm bg-paper px-2 text-xs font-medium text-ink-2">
              Legal
            </span>
            <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.02em] sm:text-4xl">{title}</h1>
            {!contents?.length ? <p className="text-[13px] text-ink-3">{updated}</p> : null}
          </div>
          <div className="flex flex-col gap-7 leading-relaxed text-ink-2 [&_h2]:scroll-mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:text-ink [&_li]:mt-1.5 [&_section]:scroll-mt-6 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
            {children}
          </div>
        </article>
      </div>
      <PubFooter />
    </div>
  );
}
