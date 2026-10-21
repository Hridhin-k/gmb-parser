import { PageHeader } from "@/components/page-header";
import { loadClusterBoard } from "@/lib/services/intelligence-cluster";
import { getActiveWorkspace } from "@/lib/services/session";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function ClusterPage() {
  const { workspaceId } = await getActiveWorkspace();
  const board = await loadClusterBoard(createAdminClient(), workspaceId);
  return (
    <div>
      <PageHeader
        title="Topic clusters"
        description="Reviews grouped by a shared topic and similar wording. A cluster is a lead, not a measured cause."
      />
      {board.unavailable ? <p className="mt-6 text-sm text-slate">{board.unavailable}</p> : null}
      {board.items.length === 0 && !board.unavailable ? (
        <p className="mt-6 max-w-xl text-sm text-slate">
          No clusters yet. They appear after a review has a topic and an embedding for its current text.
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-4">
        {board.items.map((cluster) => (
          <article key={cluster.clusterKey} className="rounded-2xl border border-silver bg-paper p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-heading text-lg text-ink">{cluster.title}</h2>
              <p className="text-xs uppercase tracking-wide text-slate">
                {cluster.quality}
                {cluster.confidence !== null ? ` · ${cluster.confidence}` : ""}
              </p>
            </div>
            <p className="mt-2 text-sm text-ink">{cluster.description}</p>
            {cluster.evidenceNote ? <p className="mt-2 text-sm text-slate">{cluster.evidenceNote}</p> : null}
            {cluster.signals.length > 0 ? (
              <p className="mt-2 text-xs text-slate">{cluster.signals.join(" · ")}</p>
            ) : null}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <section>
                <h3 className="text-xs uppercase tracking-wide text-slate">Locations</h3>
                <ul className="mt-2 space-y-1 text-sm text-ink">
                  {cluster.locations.map((location) => (
                    <li key={location.locationId}>
                      {location.title} · {location.count}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-xs uppercase tracking-wide text-slate">Months</h3>
                <ul className="mt-2 space-y-1 text-sm text-ink">
                  {cluster.months.map((month) => (
                    <li key={month.month}>
                      {month.month} · {month.count}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <h3 className="mt-4 text-xs uppercase tracking-wide text-slate">Reviews</h3>
            <ul className="mt-2 space-y-2">
              {cluster.reviews.map((review) => (
                <li key={review.reviewId} className="text-sm">
                  <a className="text-ink underline" href={review.href}>
                    {review.excerpt || "Review"}
                  </a>
                  <span className="text-slate"> · {review.locationTitle} · {review.createdAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
