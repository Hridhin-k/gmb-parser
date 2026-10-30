import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { GoogleMark } from "@/components/google-mark";
import { AuthCard, googleButtonClass } from "@/components/pub-shell";
import { readOnboardingLink } from "@/lib/services/agency-clients";
import { BusinessMark, ExtPage, ExtSideCard } from "../_components/ext-chrome";

export default async function ClientOnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await readOnboardingLink(token);
  const googleReady = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI
  );

  if (link.state !== "open" || !link.clientName) {
    const used = link.state === "used";
    return (
      <ExtPage name={link.clientName}>
        <AuthCard className="gap-3.5">
          {link.clientName ? (
            <span className="flex items-center gap-2">
              <BusinessMark name={link.clientName} size="sm" />
              <b className="text-sm font-semibold">{link.clientName}</b>
            </span>
          ) : null}
          <Badge variant={used ? "ok" : "default"}>{used ? "Already used" : "Link unavailable"}</Badge>
          <h1 className="text-lg font-semibold text-ink">
            {used ? "This link was already used" : "This link has expired"}
          </h1>
          <p className="text-[15px] leading-relaxed text-ink-2">
            {used
              ? "Someone already finished the Google authorization with this link, so there's nothing more to do here. If that wasn't expected, contact the agency that sent it."
              : "This link has expired or has already been used. Ask the agency that sent it for a new link."}
          </p>
          <p className="text-xs text-ink-3">Nothing on this page touches your Google account.</p>
        </AuthCard>
      </ExtPage>
    );
  }

  return (
    <ExtPage name={link.clientName} note="Secure link · single use">
      <div className="grid w-full max-w-[944px] items-start gap-6 lg:grid-cols-[minmax(0,600px)_320px]">
        <AuthCard className="max-w-none gap-5 sm:p-9">
          <div className="flex flex-col gap-2">
            <Badge className="w-fit">Connection request</Badge>
            <h1 className="text-[22px] font-semibold leading-snug tracking-[-0.01em] text-ink sm:text-2xl">
              Connect Google for {link.clientName}
            </h1>
            <p className="text-[15px] leading-relaxed text-ink-2">
              {link.clientName} can authorize the Google account that manages its Business Profile. The agency that
              sent this link uses RevuPilot to read and reply to your Google reviews.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 rounded-lg bg-paper p-4">
            <span className="text-xs font-semibold text-ink-3">What you&apos;re granting</span>
            <div className="flex flex-wrap gap-2">
              <Badge variant="ok">See locations</Badge>
              <Badge variant="ok">Read reviews</Badge>
              <Badge variant="ok">Post replies under your profiles</Badge>
            </div>
            <span className="mt-1 text-xs font-semibold text-ink-3">What stays with you</span>
            <p className="text-[13px] leading-relaxed text-ink-3">
              Google asks for permission to manage the Business Profiles this account owns or manages, and shares the
              account&apos;s email. You keep ownership of the profiles and can revoke access at any time from your
              Google Account.
            </p>
          </div>

          {googleReady ? (
            <>
              <a
                href={`/api/google/client-connect?token=${encodeURIComponent(token)}`}
                className={`${googleButtonClass} sm:w-fit sm:px-5`}
              >
                <GoogleMark className="size-[18px]" />
                Continue with Google
              </a>
              <p className="-mt-2 text-xs text-ink-3">
                Use the Google account that is an Owner or Manager of the profiles. Google asks you to sign in and shows
                its own permission screen. This page never asks for a Google password.
              </p>
            </>
          ) : (
            <Banner tone="warn" title="Google connection is not configured on this server." role="status">
              Let the agency know; nothing has been shared.
            </Banner>
          )}
        </AuthCard>

        <aside className="flex flex-col gap-3">
          <ExtSideCard title="What happens next">
            <ol className="list-decimal space-y-0.5 pl-[18px]">
              <li>Google asks you to confirm the permissions</li>
              <li>You land on a confirmation page; nothing else to do</li>
              <li>The agency sees the connection and can sync your locations</li>
            </ol>
          </ExtSideCard>
          <ExtSideCard title="Is this legitimate?">
            <span className="text-ink-3">
              This link was created in a RevuPilot workspace for {link.clientName}. If you don&apos;t recognise the
              agency that sent it, don&apos;t continue. The link works once.
            </span>
          </ExtSideCard>
        </aside>
      </div>
    </ExtPage>
  );
}
