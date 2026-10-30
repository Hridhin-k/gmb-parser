import Link from "next/link";
import { Check } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { GoogleMark } from "@/components/google-mark";
import { buttonVariants } from "@/components/ui/button";
import { PubFooter, PubNav } from "@/components/pub-shell";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#agencies", label: "For agencies" },
  { href: "#security", label: "Security" },
];

const STEPS: Array<{ title: string; body: string; tone: string }> = [
  {
    title: "Read & triage",
    body: "Every review from every location in one list, filtered by business, rating, status or date.",
    tone: "bg-brand",
  },
  {
    title: "Draft with AI",
    body: "Generate a reply that fits the review and the location. Drafts are clearly marked and never auto-published.",
    tone: "bg-ai",
  },
  {
    title: "Approve & publish",
    body: "An owner or admin approves, then the reply goes live on Google. Failed publishes can be retried.",
    tone: "bg-brand",
  },
  {
    title: "Escalate what matters",
    body: "Turn a complaint into a case with an owner, and track it until it's resolved.",
    tone: "bg-bad",
  },
];

const FACTS: Array<[string, string]> = [
  ["All", "locations in one reviews list"],
  ["1 click", "AI draft per review"],
  ["2-step", "approve, then publish"],
  ["100%", "of replies approved by a person before publishing"],
];

const AGENCY_POINTS = [
  "Portfolio view across every business you manage",
  "Roles for owners, admins, managers and members",
  "Client links to connect Google without sharing passwords",
  "Review requests by link or QR code, with the same Google option for every customer",
  "Audit log of every sync, draft, approval and publish",
];

const ROLES: Array<[string, string]> = [
  ["Owner", "Runs the workspace, connects Google, and invites people."],
  ["Admin", "Manages people and approvals across the whole workspace."],
  ["Manager", "Covers one business, one group, or one location."],
  ["Member", "Drafts replies and publishes them after approval."],
];

const SECURITY: Array<[string, string]> = [
  ["Human in the loop, always", "AI drafts are labelled and kept apart from approved and published text. Approval rights follow your roles."],
  ["Google-verified access", "Sign in with Google and connect the account that manages your profiles. Clients can grant access through a link."],
  ["No surprises on Google", "Nothing reaches Google until a person publishes an approved reply, and every step is logged."],
];

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  const primaryHref = signedIn ? "/overview" : "/login";

  return (
    <div className="min-h-screen bg-white text-[15px] text-ink">
      <PubNav links={NAV_LINKS} className="sticky top-0 z-30">
        {signedIn ? (
          <SignOutButton className={buttonVariants({ variant: "outline" })} />
        ) : (
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>
            Sign in
          </Link>
        )}
        <Link href={primaryHref} className={buttonVariants()}>
          {signedIn ? "Open workspace" : "Start free"}
        </Link>
      </PubNav>

      <main>
        <section className="mx-auto grid max-w-[1120px] items-center gap-12 px-4 pt-14 pb-12 sm:px-8 lg:grid-cols-2 lg:gap-14 lg:pt-20">
          <div className="flex flex-col gap-5">
            <span className="inline-flex h-[22px] w-fit items-center gap-1.5 rounded-sm bg-brand-tint px-2 text-xs font-medium text-brand">
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              Google Business Profile review management
            </span>
            <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[44px]">
              Every review answered. Every complaint owned. Every location in one view.
            </h1>
            <p className="max-w-[520px] text-[17px] leading-relaxed text-ink-2">
              RevuPilot brings reviews from every business you manage into one list, drafts replies your team approves,
              escalates what matters, and publishes back to Google.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={primaryHref} className={buttonVariants({ size: "lg" })}>
                {!signedIn ? (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-white">
                    <GoogleMark className="size-3.5" />
                  </span>
                ) : null}
                {signedIn ? "Open workspace" : "Start with Google"}
              </Link>
              <a href="#product" className={buttonVariants({ variant: "outline", size: "lg" })}>
                See how it works
              </a>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink-3">
              {["Free to start", "Drafts stay private until approved", "Works for many businesses"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-ok" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <ProductPreview />
        </section>

        <section className="mx-auto max-w-[1120px] px-4 pb-14 sm:px-8">
          <dl className="grid grid-cols-2 gap-6 border-y border-line py-5 lg:grid-cols-4">
            {FACTS.map(([value, label]) => (
              <div key={label}>
                <dt className="text-[26px] font-bold tracking-[-0.02em] tabular-nums">{value}</dt>
                <dd className="text-[13px] text-ink-3">{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="product" className="mx-auto flex max-w-[1120px] scroll-mt-20 flex-col gap-9 px-4 pb-18 sm:px-8">
          <div className="flex max-w-[640px] flex-col gap-2.5">
            <h2 className="text-[28px] font-semibold tracking-[-0.02em]">How a review becomes a reply</h2>
            <p className="leading-relaxed text-ink-2">
              Four steps, each visible to the whole team. Nothing is published without approval, and every step is
              logged.
            </p>
          </div>
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-2.5 rounded-lg border border-line bg-white p-5">
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold text-white",
                    step.tone
                  )}
                >
                  {index + 1}
                </span>
                <h3 className="text-base font-semibold">{step.title}</h3>
                <p className="text-[13px] leading-relaxed text-ink-2">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="agencies" className="scroll-mt-20 bg-paper py-16 sm:py-18">
          <div className="mx-auto grid max-w-[1120px] items-center gap-12 px-4 sm:px-8 lg:grid-cols-2 lg:gap-14">
            <div className="flex flex-col gap-3.5">
              <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Built for agencies and multi-location brands</h2>
              <p className="leading-relaxed text-ink-2">
                Manage every business in one workspace. Scope any page to a business, a group or a single location.
              </p>
              <ul className="list-disc space-y-1 pl-[18px] leading-relaxed text-ink-2">
                {AGENCY_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <Link href={primaryHref} className={buttonVariants({ className: "w-fit" })}>
                {signedIn ? "Open workspace" : "Create a workspace"}
              </Link>
            </div>
            <div className="rounded-lg border border-line bg-white">
              <p className="border-b border-line px-4 py-3 text-sm font-semibold">Roles</p>
              <ul className="divide-y divide-line">
                {ROLES.map(([role, detail]) => (
                  <li key={role} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
                    <span className="w-20 shrink-0 text-sm font-semibold">{role}</span>
                    <span className="text-[13px] text-ink-2">{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="security" className="mx-auto grid max-w-[1120px] scroll-mt-20 gap-6 px-4 py-16 sm:px-8 md:grid-cols-3 sm:py-18">
          {SECURITY.map(([title, body]) => (
            <div key={title} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="text-[13px] leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </section>

        <section className="bg-ink py-14 text-white sm:py-16">
          <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-6 px-4 sm:px-8">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-white">Start with your first location today</h2>
              <p className="text-[#afb7c6]">Sign in with Google, connect your profiles, and clear the unanswered queue in one sitting.</p>
            </div>
            <Link href={primaryHref} className={buttonVariants({ size: "lg" })}>
              {signedIn ? "Open workspace" : "Start free"}
            </Link>
          </div>
        </section>
      </main>

      <PubFooter />
    </div>
  );
}

/** Illustrative, data-free preview of the reviews list. */
function ProductPreview() {
  const rows: Array<{ stars: number; tag: string; tagClass: string; rowClass?: string; lines: [string, string] }> = [
    { stars: 2, tag: "Complaint", tagClass: "bg-bad-tint text-bad", lines: ["w-24", "w-4/5"] },
    { stars: 5, tag: "AI draft", tagClass: "bg-ai-tint text-ai", rowClass: "border-ai-line bg-[#fbf9ff]", lines: ["w-20", "w-3/5"] },
    { stars: 4, tag: "Published", tagClass: "bg-ok-tint text-ok", lines: ["w-28", "w-2/3"] },
  ];
  return (
    <div aria-hidden className="overflow-hidden rounded-lg border border-line bg-white shadow-[0_24px_60px_rgba(20,24,31,0.12)]">
      <div className="flex items-center gap-1.5 border-b border-line bg-paper px-3 py-2 text-[11px] text-ink-3">
        <span className="size-2 rounded-full bg-bad" />
        <span className="size-2 rounded-full bg-warn" />
        <span className="size-2 rounded-full bg-ok" />
        <span className="ml-auto">RevuPilot · Reviews</span>
      </div>
      <div className="flex h-[300px] text-xs">
        <div className="hidden w-[140px] shrink-0 flex-col gap-1 border-r border-line p-2.5 sm:flex">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Work</span>
          <span className="rounded px-2 py-1 text-ink-2">Overview</span>
          <span className="rounded border border-brand-line bg-brand-tint px-2 py-1 font-medium text-brand">Reviews</span>
          <span className="rounded px-2 py-1 text-ink-2">Escalations</span>
          <span className="mt-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Understand</span>
          <span className="rounded px-2 py-1 text-ink-2">Analytics</span>
          <span className="rounded px-2 py-1 text-ink-2">Insights</span>
        </div>
        <div className="flex flex-1 flex-col bg-paper">
          <div className="flex gap-1.5 border-b border-line bg-white px-3 py-2">
            <span className="h-6 w-28 rounded-md border border-line bg-white" />
            <span className="h-6 w-20 rounded-md border border-line bg-white" />
          </div>
          <div className="flex flex-col gap-1.5 p-2.5">
            {rows.map((row) => (
              <div key={row.tag} className={cn("flex items-start gap-2.5 rounded-md border border-line bg-white px-2.5 py-2", row.rowClass)}>
                <span className="mt-0.5 size-3.5 shrink-0 rounded-[3px] border-[1.5px] border-[#aeb6c2]" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="tracking-[-1px] text-star">
                      {"★".repeat(row.stars)}
                      <span className="text-line">{"★".repeat(5 - row.stars)}</span>
                    </span>
                    <span className={cn("h-2 rounded-full bg-line", row.lines[0])} />
                  </div>
                  <span className={cn("h-2 rounded-full bg-line-2", row.lines[1])} />
                </div>
                <span className={cn("inline-flex h-[18px] items-center rounded-sm px-1.5 text-[10px] font-medium", row.tagClass)}>
                  {row.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
