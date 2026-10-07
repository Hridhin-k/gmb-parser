"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

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

const TABS = [
  { id: "inbox", label: "Reply inbox" },
  { id: "businesses", label: "Businesses" },
  { id: "team", label: "Team" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const pill =
  "inline-flex h-10 items-center rounded-full px-6 text-body-sm font-medium";

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  const primaryHref = signedIn ? "/dashboard" : "/login";
  const primaryLabel = signedIn ? "Open workspace" : "Sign in with Google";
  const [tab, setTab] = useState<TabId>("inbox");

  return (
    <div className="min-h-screen bg-canvas-white text-charcoal-ink">
      <div className="sticky top-0 z-20">
        <div className="flex h-12 items-center justify-center border-b border-mist bg-canvas-white px-6 text-body-sm text-graphite">
          <p>
            Connect the Google account that manages your businesses.{" "}
            <Link
              href={primaryHref}
              className="text-google-blue underline decoration-1 underline-offset-2 hover:text-google-blue-deep"
            >
              {signedIn ? "Open workspace" : "Sign in"}
            </Link>
          </p>
        </div>

        <header className="grid h-16 grid-cols-[1fr_auto] items-center gap-4 border-b border-mist bg-white px-6 md:grid-cols-[1fr_auto_1fr]">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-google-blue text-sm font-medium text-white">
              G
            </span>
            <span className="font-display text-subheading font-medium text-charcoal-ink">
              GRM
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Page">
            <a href="#product" className="text-body-sm text-graphite hover:text-charcoal-ink">
              Product
            </a>
            <a href="#how" className="text-body-sm text-graphite hover:text-charcoal-ink">
              How it works
            </a>
            <a href="#team" className="text-body-sm text-graphite hover:text-charcoal-ink">
              Team
            </a>
          </nav>

          <div className="flex items-center justify-end gap-4">
            {signedIn ? (
              <a href="/api/auth/signout" className="text-body-sm text-graphite hover:text-charcoal-ink">
                Sign out
              </a>
            ) : (
              <Link href="/login" className="text-body-sm text-graphite hover:text-charcoal-ink">
                Sign in
              </Link>
            )}
          </div>
        </header>
      </div>

      <nav
        className="flex gap-6 overflow-x-auto border-b border-mist bg-white px-6 py-3 md:hidden"
        aria-label="Page"
      >
        <a href="#product" className="shrink-0 text-body-sm text-graphite">Product</a>
        <a href="#how" className="shrink-0 text-body-sm text-graphite">How it works</a>
        <a href="#team" className="shrink-0 text-body-sm text-graphite">Team</a>
      </nav>

      <main>
        <section className="mx-auto flex max-w-[800px] flex-col items-center px-6 pt-20 pb-16 text-center">
          <div className="mb-8 flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-google-blue text-sm font-medium text-white">
              G
            </span>
            <span className="font-display text-subheading font-medium">GRM</span>
          </div>
          <h1 className="max-w-[16ch] font-display text-[40px] leading-[1.15] font-normal tracking-[-0.3px] text-charcoal-ink sm:text-[56px] lg:text-[80px] lg:leading-[1.09] lg:tracking-[-0.8px]">
            Every Google review, one workspace.
          </h1>
          <p className="mt-6 max-w-[640px] text-subheading text-slate">
            Pull the businesses you manage, read the reviews, and publish replies back to Google.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href={primaryHref} className={cn(pill, "bg-google-blue text-white hover:bg-google-blue-deep")}>
              {primaryLabel}
            </Link>
            <a
              href="#how"
              className={cn(pill, "border border-mist bg-transparent text-google-blue hover:border-google-blue hover:bg-canvas-white")}
            >
              See how it works
            </a>
          </div>
        </section>

        <section id="product" className="mx-auto max-w-[1200px] px-6 pt-16 pb-20">
          <div className="grid gap-6 md:grid-cols-2">
            <FeatureCard
              title="A reply inbox"
              body="Drafts stay in GRM until they are approved. Published means the reply is on Google."
              href={primaryHref}
              preview={<InboxPreview />}
            />
            <FeatureCard
              title="One list of businesses"
              body="Sync profiles pulls every Business Profile that the connected account can manage."
              href={primaryHref}
              preview={<BusinessPreview />}
            />
          </div>

          <div
            className="mx-auto mt-20 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-mist bg-white p-1"
            role="tablist"
            aria-label="Product areas"
          >
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "rounded-full px-4 py-2 text-body-sm whitespace-nowrap",
                    active
                      ? "bg-canvas-white font-medium text-charcoal-ink"
                      : "font-normal text-slate"
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-2" role="tabpanel">
            {tab === "inbox" && (
              <>
                <FeatureCard
                  title="Approve before it goes live"
                  body="Members write the reply. An owner or admin approves it. Then anyone on the team can publish."
                  href="#team"
                  preview={<ApprovalPreview />}
                />
                <FeatureCard
                  title="See what still needs a reply"
                  body="Unanswered reviews stay in one queue, with the rating and the business beside each one."
                  href={primaryHref}
                  preview={<QueuePreview />}
                />
              </>
            )}
            {tab === "businesses" && (
              <>
                <FeatureCard
                  title="Profiles from the connected account"
                  body="You only see locations where the connected Google account is an Owner or Manager."
                  href={primaryHref}
                  preview={<LocationPreview />}
                />
                <FeatureCard
                  title="Sync when you are ready"
                  body="Pull new reviews into the workspace, then answer them without leaving GRM."
                  href={primaryHref}
                  preview={<SyncPreview />}
                />
              </>
            )}
            {tab === "team" && (
              <>
                <FeatureCard
                  title="Roles that match the work"
                  body="Owners connect Google and invite people. Admins approve. Members draft and publish."
                  href="#team"
                  preview={<RolesPreview />}
                />
                <FeatureCard
                  title="Invite with a Google email"
                  body="Teammates sign in with the same email you invite. They see your clients and reviews."
                  href={primaryHref}
                  preview={<InvitePreview />}
                />
              </>
            )}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-[1200px] px-6 py-20">
          <h2 className="font-display text-heading text-charcoal-ink lg:text-heading-lg">
            Three steps, then the inbox is yours.
          </h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-3xl bg-white p-8">
                <p className="text-body-sm font-medium text-google-blue">{step.n}</p>
                <h3 className="mt-4 font-display text-heading-sm font-medium text-charcoal-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-body text-slate">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="team" className="mx-auto grid max-w-[1200px] items-center gap-10 px-6 py-20 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-heading text-charcoal-ink lg:text-heading-lg">
              Members write. Owners approve.
            </h2>
            <p className="mt-6 max-w-[640px] text-subheading text-slate">
              Invite someone with the Google email they will use to sign in. They see your clients and reviews. They cannot approve a draft.
            </p>
            <Link
              href={primaryHref}
              className="mt-6 inline-block text-body text-google-blue underline decoration-1 underline-offset-2 hover:text-google-blue-deep"
            >
              {signedIn ? "Open workspace" : "Try now"} →
            </Link>
          </div>
          <ul className="rounded-3xl bg-white p-8">
            {[
              ["Owner", "Connects Google, invites people, approves replies."],
              ["Admin", "Approves replies and can invite teammates."],
              ["Member", "Drafts replies and publishes them after approval."],
            ].map(([role, detail]) => (
              <li key={role} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-google-blue" />
                <div>
                  <p className="text-body font-medium text-charcoal-ink">{role}</p>
                  <p className="mt-1 text-body-sm text-slate">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-mist">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-8 text-body-sm text-slate">
          <p>GRM — Google review management</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/privacy" className="text-google-blue underline decoration-1 underline-offset-2 hover:text-google-blue-deep">
              Privacy
            </Link>
            <Link href="/terms" className="text-google-blue underline decoration-1 underline-offset-2 hover:text-google-blue-deep">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  title,
  body,
  href,
  preview,
}: {
  title: string;
  body: string;
  href: string;
  preview: ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-3xl bg-white">
      <div className="bg-feature-tint p-2">
        <div className="rounded-2xl bg-white p-4">{preview}</div>
      </div>
      <div className="p-8">
        <h3 className="font-display text-heading-sm font-medium text-charcoal-ink">{title}</h3>
        <p className="mt-2 text-body text-slate">{body}</p>
        <Link
          href={href}
          className="mt-4 inline-block text-body text-google-blue underline decoration-1 underline-offset-2 hover:text-google-blue-deep"
        >
          Learn more →
        </Link>
      </div>
    </article>
  );
}

function InboxPreview() {
  return (
    <div className="space-y-3">
      {[
        ["Harbor Dental", "Kind staff and a calm waiting room.", "5"],
        ["Elm Street Coffee", "Oat latte was perfect.", "4"],
      ].map(([place, quote, stars]) => (
        <div key={place} className="flex items-start justify-between gap-3 border-b border-mist pb-3 last:border-0 last:pb-0">
          <div>
            <p className="text-body-sm font-medium text-charcoal-ink">{place}</p>
            <p className="mt-1 text-caption text-slate">{quote}</p>
          </div>
          <span className="inline-flex items-center gap-1 text-caption text-slate">
            <Star className="h-3 w-3 fill-google-blue text-google-blue" aria-hidden />
            {stars}
          </span>
        </div>
      ))}
    </div>
  );
}

function BusinessPreview() {
  return (
    <ul className="space-y-3">
      {[
        ["Harbor Dental", "Synced"],
        ["Northline Fitness", "Synced"],
        ["Elm Street Coffee", "Waiting"],
      ].map(([name, status]) => (
        <li key={name} className="flex items-center justify-between gap-3">
          <p className="text-body-sm text-charcoal-ink">{name}</p>
          <span className="rounded-full bg-canvas-white px-3 py-1 text-caption text-slate">{status}</span>
        </li>
      ))}
    </ul>
  );
}

function ApprovalPreview() {
  return (
    <div>
      <p className="text-caption text-slate">Draft reply</p>
      <p className="mt-2 text-body-sm text-graphite">
        Thank you for the kind words. We are glad the visit felt calm.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <span className="inline-flex h-8 items-center rounded-full border border-mist px-4 text-caption text-google-blue">
          Edit
        </span>
        <span className="inline-flex h-8 items-center rounded-full bg-google-blue px-4 text-caption text-white">
          Approve
        </span>
      </div>
    </div>
  );
}

function QueuePreview() {
  return (
    <ul className="space-y-3">
      {[
        ["Northline Fitness", "2 unanswered"],
        ["Harbor Dental", "1 unanswered"],
      ].map(([name, count]) => (
        <li key={name} className="flex items-center justify-between">
          <p className="text-body-sm text-charcoal-ink">{name}</p>
          <p className="text-caption text-google-blue">{count}</p>
        </li>
      ))}
    </ul>
  );
}

function LocationPreview() {
  return (
    <ul className="space-y-3">
      {[
        ["Harbor Dental", "12 Market Street"],
        ["Northline Fitness", "88 King Road"],
      ].map(([name, address]) => (
        <li key={name}>
          <p className="text-body-sm font-medium text-charcoal-ink">{name}</p>
          <p className="text-caption text-slate">{address}</p>
        </li>
      ))}
    </ul>
  );
}

function SyncPreview() {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-body-sm font-medium text-charcoal-ink">Last synced</p>
        <p className="text-caption text-slate">Today, 9:41 AM</p>
      </div>
      <span className="inline-flex h-8 items-center rounded-full border border-mist px-4 text-caption text-google-blue">
        Sync reviews
      </span>
    </div>
  );
}

function RolesPreview() {
  return (
    <ul className="space-y-2">
      {[
        ["Alex Chen", "Owner"],
        ["Priya Shah", "Admin"],
        ["Sam Ortiz", "Member"],
      ].map(([name, role]) => (
        <li key={name} className="flex items-center justify-between">
          <p className="text-body-sm text-charcoal-ink">{name}</p>
          <p className="text-caption text-slate">{role}</p>
        </li>
      ))}
    </ul>
  );
}

function InvitePreview() {
  return (
    <div>
      <p className="text-caption text-slate">Google email</p>
      <p className="mt-2 rounded border border-mist px-3 py-2 text-body-sm text-charcoal-ink">
        teammate@company.com
      </p>
      <p className="mt-3 text-caption text-classroom-green">Invite sent</p>
    </div>
  );
}
