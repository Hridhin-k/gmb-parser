import Link from "next/link";

export function LegalDocument({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#fafaf8] text-[#18161a]">
      <header className="border-b border-[#ede9ff]">
        <div className="mx-auto flex max-w-[800px] items-center justify-between px-5 py-5">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg tracking-[-0.03em]"
            style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4823ff] text-xs font-bold text-white">
              G
            </span>
            GRM
          </Link>
          <Link href="/login" className="text-sm font-medium text-[#4823ff]">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[800px] px-5 py-12">
        <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#4823ff]">
          {updated}
        </p>
        <h1
          className="mt-3 text-[32px] leading-[1.1] tracking-[-0.032em] sm:text-[40px]"
          style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
        >
          {title}
        </h1>
        <div className="mt-10 space-y-8 text-base font-light leading-relaxed text-[#18161a] [&_h2]:text-[22px] [&_h2]:font-normal [&_h2]:tracking-[-0.02em] [&_h2]:text-[#18161a] [&_li]:mt-2 [&_strong]:font-medium [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
        <p className="mt-12 text-sm text-[#898b91]">
          <Link href="/privacy" className="font-medium text-[#4823ff]">
            Privacy
          </Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="font-medium text-[#4823ff]">
            Terms
          </Link>
          <span className="mx-2">·</span>
          <Link href="/" className="font-medium text-[#4823ff]">
            Home
          </Link>
        </p>
      </main>
    </div>
  );
}
