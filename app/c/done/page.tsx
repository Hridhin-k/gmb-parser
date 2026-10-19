export default async function ClientOnboardingDonePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const expired = params.expired === "1";
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-medium text-graphite">{expired ? "Link unavailable" : "Google authorization finished"}</h1>
      <p className="mt-3 text-sm text-slate">
        {expired
          ? "Ask the agency for a new link. The previous one has expired or was already used."
          : "The Google account you just authorized is stored for this client. You can close this page."}
      </p>
    </main>
  );
}
