import { notFound } from "next/navigation";
import { pageCopy } from "@/lib/review-requests";
import { openPublicRequest } from "@/lib/services/request-campaigns";

export const dynamic = "force-dynamic";

interface PublicRequestPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PublicRequestPage({ params, searchParams }: PublicRequestPageProps) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const page = await openPublicRequest(token);
  if (!page) notFound();
  const copy = pageCopy(page.language, page.locationName);
  const sent = query.sent === "1";
  const stopped = query.stopped === "1";
  const qrStop = query.stopped === "qr";

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10">
      <p className="text-sm text-slate">{page.locationName}</p>
      <h1 className="mt-2 font-heading text-2xl text-ink">{page.model.question}</h1>
      <p className="mt-2 text-sm text-slate">{page.model.both}</p>
      {sent ? <p className="mt-4 text-sm text-graphite">{copy.thanks}</p> : null}
      {stopped ? <p className="mt-4 text-sm text-graphite">{copy.stopped}</p> : null}
      {qrStop ? (
        <p className="mt-4 text-sm text-graphite">This code is not tied to a phone or email, so there is no message to stop.</p>
      ) : null}
      <div className="mt-6 grid gap-2">
        {page.googleUrl ? (
          <a href={`/r/${token}/google`} className="rounded-md bg-ink px-3 py-3 text-center text-sm text-white">
            {page.model.googleLabel}
          </a>
        ) : (
          <p className="rounded-md border border-line px-3 py-3 text-sm text-slate">{copy.missingPlace}</p>
        )}
        <form action={`/r/${token}/feedback`} method="post" className="rounded-md border border-ink p-3">
          <p className="text-sm font-medium text-ink">{page.model.privateLabel}</p>
          <textarea name="body" required maxLength={2000} rows={4} placeholder={copy.placeholder} className="mt-2 w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
          <button type="submit" className="mt-2 w-full rounded-md border border-ink px-3 py-2 text-sm text-ink">
            {copy.submit}
          </button>
        </form>
      </div>
      <form id="stop" action={`/r/${token}/opt-out`} method="post" className="mt-8">
        <button type="submit" className="text-sm text-slate underline">
          {copy.optOut}
        </button>
      </form>
    </main>
  );
}
