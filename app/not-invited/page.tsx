import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/services/session";
import { isSuperAdmin } from "@/lib/services/platform";
import { inspectTenantAccess } from "@/lib/services/workspace";
import { RequestAccessForm } from "@/components/request-access-form";
import { Banner, type BannerTone } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { AuthCard, IdentityTag, PubNav, PubPage } from "@/components/pub-shell";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Published contact address (see /privacy and /terms). */
const SUPPORT_EMAIL = "hridhin@explaineddigital.com";

type Copy = {
  title: string;
  body: string;
  /** Shown as a banner: what is kept / what is paused. */
  notice?: { tone: BannerTone; text: string };
  contactSubject?: string;
};

function copyFor(reason: string | null): Copy {
  switch (reason) {
    case "suspended":
      return {
        title: "Your workspace is suspended",
        body: "Only the platform team can restore access. Contact support and mention the email below.",
        notice: { tone: "warn", text: "A platform administrator has suspended your workspace. Your data is kept." },
        contactSubject: "Suspended workspace",
      };
    case "deleted":
      return {
        title: "Your workspace is no longer available",
        body: "Contact support if this was a mistake.",
        notice: { tone: "warn", text: "A platform administrator has removed your workspace. Your data is retained for recovery." },
        contactSubject: "Workspace removed",
      };
    case "blocked":
      return {
        title: "This account has been blocked",
        body: "If you believe this is a mistake, contact support with the email below.",
        notice: { tone: "bad", text: "This email has been blocked from the platform by an administrator." },
        contactSubject: "Blocked account",
      };
    case "plan_expired":
      return {
        title: "Your plan has expired",
        body: "Contact support to renew and restore access.",
        notice: { tone: "warn", text: "Your workspace's plan or trial has ended." },
        contactSubject: "Plan renewal",
      };
    default:
      return {
        title: "You need an invitation",
        body: "RevuPilot is invite-only. This Google account doesn't have an invite yet, so no workspace was created for it. Ask the platform team, or whoever manages your business's reviews, to invite this exact email, then sign in again.",
      };
  }
}

export default async function NotInvitedPage({ searchParams }: PageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login");
  if (isSuperAdmin(user)) redirect("/admin");
  const reason = typeof params.reason === "string" ? params.reason : null;
  // If access opened up (invite arrived / tenant reactivated), let them in.
  if (!reason) {
    const access = await inspectTenantAccess(user).catch(() => null);
    if (access?.kind === "allowed") redirect("/overview");
    if (access?.kind === "setup") redirect("/create-tenant");
  }
  const copy = copyFor(reason);
  const mailto = copy.contactSubject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`RevuPilot: ${copy.contactSubject}`)}`
    : null;

  return (
    <PubPage className="justify-center" nav={<PubNav />}>
      <AuthCard className="gap-3.5">
        {user.email ? <IdentityTag email={user.email} /> : null}
        <h1 className="text-lg font-semibold text-ink">{copy.title}</h1>
        {copy.notice ? (
          <Banner tone={copy.notice.tone} role="status">
            {copy.notice.text}
          </Banner>
        ) : null}
        <p className="text-[15px] leading-relaxed text-ink-2">{copy.body}</p>

        {!reason ? <RequestAccessForm /> : null}

        {mailto ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={mailto} className={buttonVariants({ size: "lg", className: "flex-1 sm:flex-none" })}>
              Contact support
            </a>
            <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg", className: "flex-1 sm:flex-none" })}>
              Check again
            </Link>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[13px]">
          <SignOutButton
            label="Use a different Google account"
            pendingLabel="Signing out…"
            className="font-medium text-brand hover:underline disabled:opacity-50"
          />
          {!mailto ? (
            <Link href="/login" className="font-medium text-ink-3 hover:text-ink">
              Already invited? Check again
            </Link>
          ) : null}
        </div>
      </AuthCard>
    </PubPage>
  );
}
