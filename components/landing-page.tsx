import Link from "next/link";

const STEPS = [
  {
    n: "01",
    title: "Sign in",
    body: "Your Google login opens GRM. The first visit creates a workspace that belongs to you.",
  },
  {
    n: "02",
    title: "Connect Google",
    body: "On Settings, connect the account that is Owner or Manager of the businesses you want to see.",
  },
  {
    n: "03",
    title: "Sync, then reply",
    body: "Sync profiles, then sync reviews. Members draft. An owner or admin approves. Anyone can publish.",
  },
];

const FEATURES = [
  {
    title: "One list of businesses",
    body: "Sync profiles pulls every Business Profile that the connected account can manage and creates a client for each one.",
  },
  {
    title: "A reply inbox",
    body: "Drafts stay in GRM until they are approved. Published means the reply is on Google.",
  },
  {
    title: "A team with roles",
    body: "Invite a teammate with their Google email. Members draft and publish. Only an owner or admin can approve.",
  },
];

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  const primaryHref = signedIn ? "/dashboard" : "/login";
  const primaryLabel = signedIn ? "Open workspace" : "Sign in with Google";

  return (
    <div className="min-h-screen bg-[#fafaf8] text-[#18161a]">
      <div className="border-b border-[#e4e2de] px-4 py-2.5 text-center text-sm text-[#18161a]">
        Sign in, then connect the Google account that manages your businesses.
      </div>

      <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4823ff] text-sm font-bold text-white">
            G
          </span>
          <span
            className="text-lg tracking-[-0.03em]"
            style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
          >
            GRM
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-[15px] font-medium sm:flex" aria-label="Page">
          <a href="#how" className="hover:text-[#18161a]">How it works</a>
          <a href="#product" className="hover:text-[#18161a]">Product</a>
          <a href="#team" className="hover:text-[#18161a]">Team</a>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <>
              <a href="/api/auth/signout" className="px-3 text-[15px] font-medium">
                Sign out
              </a>
              <Link
                href="/dashboard"
                className="inline-flex h-10 items-center rounded-full bg-[#4823ff] px-5 text-[15px] font-semibold text-white hover:bg-[#3a1ad6]"
              >
                Open workspace
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="hidden px-3 text-[15px] font-medium sm:inline">
                Sign in
              </Link>
              <Link
                href="/login"
                className="inline-flex h-10 items-center rounded-full border border-[#e4e2de] bg-white px-5 text-[15px] font-semibold text-[#18161a] hover:border-[#18161a]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pt-10 pb-20 lg:grid-cols-2 lg:pt-16">
          <div>
            <p className="text-[12px] font-medium tracking-[0.06em] text-[#8a877f] uppercase">
              Google reviews
            </p>
            <h1
              className="mt-4 text-[44px] leading-none tracking-[-0.04em] text-[#18161a] sm:text-[63px]"
              style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
            >
              Every Google review, one workspace.
            </h1>
            <p className="mt-5 max-w-md text-lg font-light leading-snug tracking-[-0.01em] text-[#18161a]">
              Pull the businesses you manage, read the reviews, and publish replies back to Google.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={primaryHref}
                className="inline-flex h-12 items-center rounded-full bg-[#4823ff] px-6 text-base font-semibold text-white hover:bg-[#3a1ad6]"
              >
                {primaryLabel}
              </Link>
              <a href="#how" className="text-[15px] font-medium text-[#4823ff]">
                See how it works →
              </a>
            </div>
          </div>

          <div className="rounded-[20px] bg-[#1e1b22] p-5 text-white">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Needs a reply</p>
              <span className="rounded-full bg-[#e7ff6e] px-3 py-1 text-xs font-semibold text-[#18161a]">
                3 waiting
              </span>
            </div>
            <ul className="mt-5 space-y-4">
              {[
                ["Harbor Dental", "5", "Kind staff and a calm waiting room.", "HK"],
                ["Northline Fitness", "2", "The 6am class started late.", "NL"],
                ["Elm Street Coffee", "4", "Oat latte was perfect.", "ES"],
              ].map(([place, stars, quote, initials]) => (
                <li key={place} className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium">{place}</p>
                      <p className="text-xs text-white/70">{stars} / 5</p>
                    </div>
                    <p className="mt-1 text-sm font-light text-white/80">{quote}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-white/50"
                        style={{ width: `${Number(stars) * 20}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="bg-[#f3f1ee]">
          <div className="mx-auto max-w-[1200px] px-5 py-20">
            <p className="text-[12px] font-medium tracking-[0.06em] text-[#8a877f] uppercase">
              How it works
            </p>
            <h2
              className="mt-3 max-w-xl text-[31px] leading-[1.2] tracking-[-0.032em]"
              style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
            >
              Three steps, then the inbox is yours.
            </h2>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.n} className="rounded-[20px] border border-[#e4e2de] bg-white p-5">
                  <p className="text-sm font-semibold text-[#18161a]">{step.n}</p>
                  <h3 className="mt-3 text-xl font-medium tracking-[-0.01em]">{step.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-[#18161a]/80">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="product" className="mx-auto max-w-[1200px] px-5 py-20">
          <p className="text-[12px] font-medium tracking-[0.06em] text-[#8a877f] uppercase">
            Product
          </p>
          <h2
            className="mt-3 text-[31px] leading-[1.2] tracking-[-0.032em]"
            style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
          >
            Built for the people who answer the reviews.
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="rounded-[20px] border border-[#e4e2de] bg-white p-5">
                <h3 className="text-xl font-medium tracking-[-0.01em]">{feature.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-[#18161a]/80">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="team" className="border-t border-[#f3f1ee]">
          <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-20 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <p className="text-[12px] font-medium tracking-[0.06em] text-[#8a877f] uppercase">
                Team
              </p>
              <h2
                className="mt-3 text-[31px] leading-[1.2] tracking-[-0.032em]"
                style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
              >
                Members write. Owners approve.
              </h2>
              <p className="mt-4 max-w-md text-lg font-light leading-snug">
                Invite someone with the Google email they will use to sign in. They see your clients and reviews. They cannot approve a draft.
              </p>
            </div>
            <ul className="rounded-[20px] border border-[#e4e2de] bg-white p-2">
              {[
                ["Owner", "Connects Google, invites people, approves replies."],
                ["Admin", "Approves replies and can invite teammates."],
                ["Member", "Drafts replies and publishes them after approval."],
              ].map(([role, detail]) => (
                <li key={role} className="flex gap-4 rounded-2xl px-4 py-4">
                  <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#18161a]" />
                  <div>
                    <p className="font-semibold">{role}</p>
                    <p className="mt-1 text-sm text-[#898b91]">{detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#f3f1ee]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-[#898b91]">
          <p>GRM — Google review management</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/privacy" className="hover:text-[#4823ff]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[#4823ff]">
              Terms
            </Link>
            <Link href={primaryHref} className="font-medium text-[#4823ff]">
              {signedIn ? "Open workspace" : "Sign in"}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
