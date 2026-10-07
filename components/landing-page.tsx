import type { ComponentType } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarRange,
  ChartColumn,
  Check,
  CircleCheck,
  History,
  Inbox,
  ListChecks,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  UserPlus,
  Users,
} from "lucide-react";
import { GoogleMark } from "@/components/google-mark";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

const STEPS: Array<{ n: string; icon: IconComponent; title: string; body: string }> = [
  {
    n: "01",
    icon: GoogleMark,
    title: "Sign in with Google",
    body: "Your Google login opens GRM. The first visit creates a workspace that belongs to you.",
  },
  {
    n: "02",
    icon: RefreshCw,
    title: "Sync your profiles",
    body: "Connect the account that owns or manages your businesses. Each brand becomes a client.",
  },
  {
    n: "03",
    icon: BadgeCheck,
    title: "Draft, approve, publish",
    body: "Members draft with AI. An owner or admin approves. The reply goes live on Google.",
  },
];

const FEATURES: Array<{ icon: IconComponent; title: string; body: string }> = [
  {
    icon: Inbox,
    title: "One reply inbox",
    body: "Every review from every location in one list, filtered by client, rating, status, or date.",
  },
  {
    icon: Sparkles,
    title: "AI drafts in your voice",
    body: "Gemini writes a reply that fits the review and the location. Regenerate until it reads right.",
  },
  {
    icon: ShieldCheck,
    title: "Approval before publishing",
    body: "Drafts stay inside GRM until an owner or admin approves them. Nothing reaches Google by accident.",
  },
  {
    icon: ListChecks,
    title: "Bulk actions",
    body: "Draft, approve, or publish a whole page of reviews at once when the queue gets long.",
  },
  {
    icon: ChartColumn,
    title: "Trends per client",
    body: "Ratings, volume, reply rate, and reply time by month, for one location or the whole agency.",
  },
  {
    icon: History,
    title: "Full audit log",
    body: "Every sync, draft, approval, and publish is recorded with who did it and when.",
  },
];

const ROLES: Array<{ icon: IconComponent; role: string; detail: string }> = [
  { icon: ShieldCheck, role: "Owner", detail: "Connects Google, invites people, approves replies." },
  { icon: BadgeCheck, role: "Admin", detail: "Approves replies and can invite teammates." },
  { icon: Users, role: "Member", detail: "Drafts replies and publishes them after approval." },
];

const pill =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-body font-medium transition-colors";

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  const primaryHref = signedIn ? "/dashboard" : "/login";
  const primaryLabel = signedIn ? "Open workspace" : "Sign in with Google";

  return (
    <div className="min-h-screen bg-paper text-graphite">
      <div className="sticky top-0 z-30">
        <div className="flex min-h-10 items-center justify-center bg-info-banner-bg px-6 py-2 text-center text-body-sm text-graphite">
          <p>
            Reply to every Google review from one place.{" "}
            <Link
              href={primaryHref}
              className="inline-flex items-center gap-1 font-medium text-action-blue hover:underline"
            >
              {signedIn ? "Open your workspace" : "Get started free"}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </p>
        </div>

        <header className="border-b border-silver bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-6">
            <Link href="/" className="flex items-center gap-2.5" aria-label="GRM home">
              <BrandMark />
              <span className="font-heading text-heading-sm text-ink">GRM</span>
            </Link>

            <nav className="hidden items-center gap-8 md:flex" aria-label="Page">
              {[
                ["#features", "Features"],
                ["#how", "How it works"],
                ["#team", "Team"],
              ].map(([href, label]) => (
                <a key={href} href={href} className="text-body-sm text-graphite hover:text-ink">
                  {label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-4">
              {signedIn ? (
                <a href="/api/auth/signout" className="hidden text-body-sm text-graphite hover:text-ink sm:inline">
                  Sign out
                </a>
              ) : (
                <Link href="/login" className="hidden text-body-sm text-graphite hover:text-ink sm:inline">
                  Sign in
                </Link>
              )}
              <Link
                href={primaryHref}
                className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-body-sm font-medium text-white shadow-button hover:bg-graphite"
              >
                {signedIn ? "Open workspace" : "Get started"}
              </Link>
            </div>
          </div>
        </header>
      </div>

      <main>
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 pt-16 pb-12 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-caption text-graphite shadow-control">
              <GoogleMark className="h-3.5 w-3.5" />
              Built on the Google Business Profile API
            </span>
            <h1 className="mt-6 font-heading text-[44px] leading-[1.1] text-ink sm:text-heading-lg lg:text-display">
              Every Google review, one workspace.
            </h1>
            <p className="mt-6 max-w-[34rem] text-subheading text-slate">
              Pull in every business you manage, draft replies with AI, approve them as a team, and
              publish back to Google.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={primaryHref} className={cn(pill, "bg-ink text-white shadow-button hover:bg-graphite")}>
                {!signedIn ? <GoogleMark className="rounded-full bg-white p-0.5" /> : null}
                {primaryLabel}
              </Link>
              <a
                href="#how"
                className={cn(pill, "border border-silver bg-white text-graphite hover:border-stone")}
              >
                See how it works
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-slate">
              {["Free to start", "Drafts stay private until approved", "Works for many clients"].map(
                (item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-ink" aria-hidden />
                    {item}
                  </li>
                )
              )}
            </ul>
          </div>

          <HeroWidget />
        </section>

        <section className="mx-auto max-w-[1200px] px-6 py-12">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-silver shadow-card sm:grid-cols-4">
            {[
              ["All", "locations in one inbox"],
              ["1 click", "AI draft per review"],
              ["2-step", "approve, then publish"],
              ["CSV", "exports for clients"],
            ].map(([value, label]) => (
              <div key={label} className="bg-white px-6 py-5">
                <p className="font-heading text-heading text-ink">{value}</p>
                <p className="mt-1 text-body-sm text-slate">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-[1200px] scroll-mt-32 px-6 py-24">
          <SectionHeading
            eyebrow="How it works"
            title="Three steps, then the inbox is yours."
            body="No spreadsheets and no copying replies into Google by hand."
          />
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-xl bg-white p-6 shadow-card">
                <div className="flex items-center justify-between">
                  <IconTile icon={step.icon} />
                  <span className="rounded-full bg-paper px-3 py-1 text-caption font-medium text-graphite">
                    {step.n}
                  </span>
                </div>
                <h3 className="mt-6 font-heading text-heading-sm text-ink">{step.title}</h3>
                <p className="mt-2 text-body text-slate">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="mx-auto max-w-[1200px] scroll-mt-32 px-6 py-24">
          <SectionHeading
            eyebrow="Features"
            title="Built for agencies that answer reviews for others."
            body="Everything a team needs to keep every client's Google profile answered."
          />
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="rounded-xl bg-white p-6 shadow-card transition-shadow hover:shadow-card-hover"
              >
                <IconTile icon={feature.icon} />
                <h3 className="mt-6 font-heading text-heading-sm text-ink">{feature.title}</h3>
                <p className="mt-2 text-body text-slate">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="team" className="mx-auto grid max-w-[1200px] scroll-mt-32 items-center gap-12 px-6 py-24 lg:grid-cols-2">
          <div>
            <p className="text-body-sm font-medium text-slate">Team</p>
            <h2 className="mt-3 font-heading text-heading text-ink sm:text-heading-lg">
              Members write. Owners approve.
            </h2>
            <p className="mt-6 max-w-[34rem] text-subheading text-slate">
              Invite teammates with the Google email they sign in with. They see your clients and
              reviews, but only an owner or admin can approve what goes live.
            </p>
            <Link
              href={primaryHref}
              className="mt-8 inline-flex items-center gap-1.5 text-body font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink"
            >
              {signedIn ? "Open workspace" : "Invite your team"}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <div className="rounded-xl bg-white p-2 shadow-card">
            <ul className="divide-y divide-silver">
              {ROLES.map(({ icon: Icon, role, detail }) => (
                <li key={role} className="flex items-start gap-4 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper text-ink">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="text-body font-medium text-graphite">{role}</p>
                    <p className="mt-0.5 text-body-sm text-slate">{detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="m-2 flex items-center justify-between gap-3 rounded-lg bg-paper px-4 py-3">
              <span className="flex min-w-0 items-center gap-2 text-body-sm text-graphite">
                <UserPlus className="h-4 w-4 shrink-0 text-slate" aria-hidden />
                <span className="truncate">teammate@youragency.com</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-success">
                <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                Invite sent
              </span>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-6 pt-12 pb-24">
          <div className="flex flex-col items-center rounded-xl bg-white px-6 py-16 text-center shadow-card">
            <BrandMark size="lg" />
            <h2 className="mt-6 max-w-[18ch] font-heading text-heading text-ink sm:text-heading-lg">
              Answer every review this week.
            </h2>
            <p className="mt-4 max-w-[32rem] text-subheading text-slate">
              Connect Google, sync your profiles, and clear the unanswered queue in one sitting.
            </p>
            <Link href={primaryHref} className={cn(pill, "mt-8 bg-ink text-white shadow-button hover:bg-graphite")}>
              {primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-silver bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-8 text-body-sm text-slate">
          <div className="flex items-center gap-2.5">
            <BrandMark size="sm" />
            <span>GRM — Google review management</span>
          </div>
          <nav className="flex flex-wrap items-center gap-6" aria-label="Legal">
            <Link href="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-ink">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-lg bg-ink font-heading text-white",
        size === "sm" && "h-6 w-6 rounded-md text-xs",
        size === "md" && "h-8 w-8 text-sm",
        size === "lg" && "h-12 w-12 rounded-xl text-xl"
      )}
      aria-hidden
    >
      G
    </span>
  );
}

function IconTile({ icon: Icon }: { icon: IconComponent }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-paper text-ink">
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-[44rem] text-center">
      <p className="text-body-sm font-medium text-slate">{eyebrow}</p>
      <h2 className="mt-3 font-heading text-heading text-ink sm:text-heading-lg">{title}</h2>
      <p className="mt-4 text-subheading text-slate">{body}</p>
    </div>
  );
}

function Stars({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i < count ? "fill-[#fbbc04] text-[#fbbc04]" : "fill-silver text-silver"
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

/** Product preview in the hero, like the design's "scheduling widget" card. */
function HeroWidget() {
  return (
    <div className="relative">
      <div className="rounded-xl bg-white p-4 shadow-card-hover sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b border-silver pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper text-ink">
              <Building2 className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-body-sm font-medium text-graphite">Harbor Dental</p>
              <p className="flex items-center gap-1 truncate text-caption text-slate">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                Kakkanad, Ernakulam
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-heading text-heading-sm text-ink">4.8</p>
            <Stars count={5} />
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-paper p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-body-sm font-medium text-graphite">Anjali Menon</p>
            <Stars count={5} />
          </div>
          <p className="mt-2 text-body-sm text-graphite">
            Kind staff and a calm waiting room. The cleaning was quick and painless.
          </p>
          <p className="mt-2 text-caption text-stone">2 days ago · Google</p>
        </div>

        <div className="mt-3 rounded-lg border border-silver p-4">
          <p className="flex items-center gap-1.5 text-caption font-medium text-slate">
            <Sparkles className="h-3.5 w-3.5 text-ink" aria-hidden />
            AI draft
          </p>
          <p className="mt-2 text-body-sm text-graphite">
            Thank you, Anjali. We are glad the visit felt calm and quick. See you at your next
            check-up.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 text-caption text-graphite">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Waiting for approval
            </span>
            <span className="flex gap-2">
              <span className="inline-flex h-8 items-center rounded-full border border-silver px-3.5 text-caption font-medium text-graphite">
                Edit
              </span>
              <span className="inline-flex h-8 items-center gap-1 rounded-full bg-ink px-3.5 text-caption font-medium text-white">
                <Check className="h-3.5 w-3.5" aria-hidden />
                Approve
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-5 -left-3 hidden items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-card-hover sm:flex">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper">
          <GoogleMark />
        </span>
        <div>
          <p className="text-caption font-medium text-graphite">Published to Google</p>
          <p className="text-caption text-slate">12 replies today</p>
        </div>
      </div>

      <div className="absolute -top-4 -right-3 hidden items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-card-hover sm:flex">
        <CalendarRange className="h-4 w-4 text-slate" aria-hidden />
        <span className="text-caption text-graphite">Last 3 months</span>
      </div>
    </div>
  );
}
