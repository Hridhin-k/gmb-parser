import Link from "next/link";
import { SyncLocationsButton } from "@/components/sync-locations-button";
import { SetupChecklist } from "@/components/setup-checklist";
import { ExportUsageButton } from "@/components/export-usage-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgencyClientRow, AgencyHome } from "@/lib/services/agency-home";

interface AgencyHomeViewProps {
  workspaceId: string;
  canSync: boolean;
  data: AgencyHome;
  clientId: string;
  /** range/from/to search params for the selected time range (empty for the default). */
  rangeParams: Record<string, string>;
  query: string;
  /** Usage totals are for people who manage the organization. */
  showUsage: boolean;
}

function formatRating(value: number | null) {
  if (value === null) return "—";
  return value.toFixed(1);
}

function formatRate(value: number | null) {
  if (value === null) return "—";
  return `${value}%`;
}

function formatCount(value: number, hasReviews: boolean) {
  if (!hasReviews) return "—";
  return value.toLocaleString("en-US");
}

function connectionLabel(row: AgencyClientRow) {
  if (row.connection === "waiting") return "Waiting for client to connect";
  if (row.connection === "attention") {
    return `${row.attentionCount} ${row.attentionCount === 1 ? "needs" : "need"} attention`;
  }
  return "All connected";
}

function pageHref(
  page: number,
  clientId: string,
  rangeParams: Record<string, string>,
  query: string
) {
  const search = new URLSearchParams();
  if (clientId) search.set("client", clientId);
  for (const [key, value] of Object.entries(rangeParams)) search.set(key, value);
  if (query) search.set("q", query);
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

export function AgencyHomeView({
  workspaceId,
  canSync,
  data,
  clientId,
  rangeParams,
  query,
  showUsage,
}: AgencyHomeViewProps) {
  const { kpis, rows, totalClients, page, pageSize } = data;
  const from = totalClients === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalClients);
  const pageCount = Math.max(1, Math.ceil(totalClients / pageSize));
  const exportParams = new URLSearchParams();
  if (clientId) exportParams.set("client", clientId);
  for (const [key, value] of Object.entries(rangeParams)) exportParams.set(key, value);
  if (query) exportParams.set("q", query);
  const exportHref = `/api/usage/export${exportParams.size ? `?${exportParams}` : ""}`;
  const queueHref = clientId ? `/clients/${clientId}` : "/clients";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-heading text-ink">All clients</h1>
        {data.connectionId && canSync ? (
          <SyncLocationsButton connectionId={data.connectionId} />
        ) : data.connectionId ? null : (
          <Button
            size="sm"
            className="rounded-md px-3"
            nativeButton={false}
            render={<Link href="/settings" />}
          >
            Connect Google
          </Button>
        )}
      </div>

      <SetupChecklist
        workspaceId={workspaceId}
        canSync={canSync}
        hasConnection={data.hasConnection}
        hasLocations={kpis.locations > 0}
        hasReviews={data.hasReviews}
        hasPublished={data.hasPublished}
      />

      <form action="/dashboard" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search clients"
          aria-label="Search clients"
          className="h-10 min-w-0 flex-1 rounded-md border border-silver bg-white px-3 text-sm text-graphite"
        />
        {clientId ? <input type="hidden" name="client" value={clientId} /> : null}
        {Object.entries(rangeParams).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <Button type="submit" variant="outline">Search</Button>
      </form>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {[
          ["Clients", kpis.clients],
          ["Locations", kpis.locations],
          ["Unreplied reviews", kpis.unreplied],
          ["Awaiting client approval", kpis.waitingApproval],
          ["Open escalations", kpis.openEscalations],
          ["Connection problems", kpis.connectionProblems],
        ].map(([label, value]) => (
          <Card key={String(label)} size="sm" className="rounded-xl py-0 shadow-card">
            <CardContent className="px-4 py-3">
              <p className="text-xs text-slate">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-graphite">
                {Number(value).toLocaleString("en-US")}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="rounded-xl py-0 shadow-card">
        <div className="overflow-x-auto">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="border-silver text-xs text-slate hover:bg-transparent">
              <TableHead className="px-4 font-medium text-slate">Client</TableHead>
              <TableHead className="font-medium text-slate">Locations</TableHead>
              <TableHead className="font-medium text-slate">Rating</TableHead>
              <TableHead className="font-medium text-slate">Reply rate</TableHead>
              <TableHead className="font-medium text-slate">Unreplied</TableHead>
              <TableHead className="font-medium text-slate">Open escalations</TableHead>
              <TableHead className="font-medium text-slate">Client approval</TableHead>
              <TableHead className="font-medium text-slate">Account manager</TableHead>
              <TableHead className="font-medium text-slate">Google connection</TableHead>
              <TableHead className="px-4">
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={11} className="px-4 py-10 text-center text-sm text-slate">
                  {query || clientId
                    ? "No clients match this search."
                    : data.connectionId
                      ? "No clients yet. Click Sync profiles — each brand on your Google account becomes a client."
                      : "No clients yet. Connect Google in Settings, then click Sync profiles."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const hasReviews = row.reviewCount > 0;
                return (
                  <TableRow key={row.id} className="border-silver">
                    <TableCell className="px-4 font-semibold text-graphite">{row.name}</TableCell>
                    <TableCell className="tabular-nums text-graphite">{row.locations}</TableCell>
                    <TableCell className="tabular-nums text-graphite">{formatRating(row.rating)}</TableCell>
                    <TableCell className="tabular-nums text-graphite">{formatRate(row.replyRate)}</TableCell>
                    <TableCell className="tabular-nums text-graphite">
                      {formatCount(row.unreplied, hasReviews)}
                    </TableCell>
                    <TableCell className="tabular-nums text-graphite">
                      {row.escalations.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="tabular-nums text-graphite">
                      {row.clientApprovals.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="text-graphite">{row.manager ?? "—"}</TableCell>
                    <TableCell
                      className={row.connection === "connected" ? "text-graphite" : "font-semibold text-graphite"}
                    >
                      {connectionLabel(row)}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/clients/${row.id}`} />}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-silver px-4 py-2.5 text-xs text-slate">
          <p>
            Showing {from}–{to} of {totalClients} clients
          </p>
          {pageCount > 1 ? (
            <div className="flex gap-2">
              {page > 1 ? (
                <Link href={pageHref(page - 1, clientId, rangeParams, query)} className="text-ink">
                  Previous
                </Link>
              ) : null}
              {page < pageCount ? (
                <Link href={pageHref(page + 1, clientId, rangeParams, query)} className="text-ink">
                  Next
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card id={showUsage ? "usage" : undefined} size="sm" className="scroll-mt-6 rounded-xl py-0 shadow-card">
        <CardContent className="p-4 sm:p-5">
        {showUsage ? (
          <>
        <h2 className="text-sm font-semibold text-graphite">{data.usageHeading}</h2>
        <p className="mt-1 text-xs text-slate">Counts of stored locations, reviews, and published replies. No price is calculated.</p>
        <ul className="mt-3 divide-y divide-silver">
          {data.usage.length === 0 ? (
            <li className="py-3 text-sm text-slate">No usage in this period.</li>
          ) : (
            data.usage.map((row) => (
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
          </>
        ) : null}

        <div className={showUsage ? "mt-5 border-t border-silver pt-4" : ""}>
          <h3 className="text-sm font-semibold text-graphite">Client approval queue</h3>
          <p className="mt-1 text-sm text-slate">
            {data.approvals === 0
              ? "No replies are waiting for the client."
              : `${data.approvals.toLocaleString("en-US")} ${
                  data.approvals === 1 ? "reply is" : "replies are"
                } waiting for the client. Approving here does not publish to Google.`}
          </p>
          <Link href={queueHref} className="mt-1 inline-block text-sm text-ink hover:underline">
            {clientId ? "Open this client" : "Open a client"}
          </Link>
        </div>
        </CardContent>
      </Card>
    </div>
  );
}
