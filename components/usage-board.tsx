import { ExportUsageButton } from "@/components/export-usage-button";
import { Card, CardContent } from "@/components/ui/card";
import type { AgencyUsageRow } from "@/lib/services/agency-home";

export function UsageBoard({
  heading,
  rows,
  exportHref,
}: {
  heading: string;
  rows: AgencyUsageRow[];
  exportHref: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-heading text-ink">Usage</h1>
        <p className="mt-1 text-sm text-slate">
          Counts of stored locations, reviews, and published replies. No price is calculated.
        </p>
      </div>
      <Card size="sm" className="rounded-xl py-0 shadow-card">
        <CardContent className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-graphite">{heading}</h2>
          <ul className="mt-3 divide-y divide-silver">
            {rows.length === 0 ? (
              <li className="py-3 text-sm text-slate">No usage in this period.</li>
            ) : (
              rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="text-graphite">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-slate">
                    {row.locations} {row.locations === 1 ? "location" : "locations"} ·{" "}
                    {row.reviews.toLocaleString("en-US")} {row.reviews === 1 ? "review" : "reviews"} ·{" "}
                    {row.publishedReplies.toLocaleString("en-US")} published
                  </span>
                </li>
              ))
            )}
          </ul>
          <ExportUsageButton href={exportHref} />
        </CardContent>
      </Card>
    </div>
  );
}
