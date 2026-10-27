import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/services/session";
import { isSuperAdmin } from "@/lib/services/platform";
import { inspectTenantAccess } from "@/lib/services/workspace";
import { RequestAccessForm } from "@/components/request-access-form";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
  const copy =
    reason === "suspended"
      ? { title: "Your workspace is suspended", body: "A platform administrator has suspended your organization. Your data is kept. Contact support to restore access." }
      : reason === "deleted"
        ? { title: "Your workspace is no longer available", body: "A platform administrator has removed your organization. Your data is retained for recovery — contact support if this was a mistake." }
        : reason === "blocked"
          ? { title: "This account is blocked", body: "This email has been blocked from the platform by an administrator. Contact support if you believe this is a mistake." }
          : reason === "plan_expired"
            ? { title: "Your plan has expired", body: "Your organization's plan or trial has ended. Contact support to renew and restore access." }
            : { title: "RevuPilot is invite-only", body: "This Google account does not have an invite yet, so no workspace was created for it. Ask the platform team to invite this exact email, then sign in again." };
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-lg rounded-xl bg-white px-5 py-8 shadow-card sm:px-8 sm:py-10">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">G</div>
        <h1 className="mt-5 text-[28px] leading-[1.2] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>{copy.title}</h1>
        <p className="mt-2 text-sm font-light leading-relaxed text-slate sm:text-base">{copy.body}</p>
        {user.email ? <p className="mt-4 text-sm text-graphite">Signed in as <span className="font-medium">{user.email}</span></p> : null}
        {!reason ? <RequestAccessForm /> : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <SignOutButton className="inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-medium text-white" />
          <Link href="/login" className="inline-flex h-9 items-center rounded-md border border-line px-4 text-sm text-graphite">Try another account</Link>
        </div>
      </div>
    </div>
  );
}
