import Link from "next/link";
import { readOnboardingLink } from "@/lib/services/agency-clients";

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

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-medium text-graphite">Connect Google</h1>
      {link.state !== "open" || !link.clientName ? (
        <p className="mt-3 text-sm text-slate">This link has expired or has already been used.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-slate">
            {link.clientName} can authorize the Google account that manages its Business Profile.
            Google asks you to sign in. This page never asks for a Google password.
          </p>
          {googleReady ? (
            <Link
              href={`/api/google/client-connect?token=${encodeURIComponent(token)}`}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-white"
            >
              Continue with Google
            </Link>
          ) : (
            <p className="mt-6 text-sm text-slate">Google connection is not configured on this server.</p>
          )}
        </>
      )}
    </main>
  );
}
