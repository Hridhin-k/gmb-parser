import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { SyncLocationsButton } from "@/components/sync-locations-button";
import { SetupChecklist } from "@/components/setup-checklist";
import { ExportUsageButton } from "@/components/export-usage-button";
import { PageHeader, PageTabs, type PageTab } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AgencyClientRow, AgencyHome } from "@/lib/services/agency-home";
import { cn } from "@/lib/utils";

interface PortfolioCommonProps {
  data: AgencyHome;
  clientId: string;
  /** range/from/to search params for the selected time range (empty for the default). */
  rangeParams: Record<string, string>;
  /** Human label of the selected range, e.g. "Last month". */
  rangeLabel?: string;
  query: string;
  /** Usage totals are for people who manage the organization. */
  showUsage: boolean;
}

interface AgencyHomeViewProps extends PortfolioCommonProps {
  workspaceId: string;
  canSync: boolean;
}

const n = (value: number) => value.toLocaleString("en-US");

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
  return n(value);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function withParams(path: string, params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

function portfolioHref(
  path: "/portfolio" | "/portfolio/usage",
  clientId: string,
  rangeParams: Record<string, string>,
  query: string,
  page = 1
) {
  return withParams(path, {
    client: clientId,
    ...rangeParams,
    q: query,
    page: page > 1 ? String(page) : "",
  });
}

function connectionTag(row: AgencyClientRow) {
  if (row.connection === "waiting") return <Badge variant="warn">Waiting to connect</Badge>;
  if (row.connection === "attention") {
    return (
      <Badge variant="bad">
        {row.attentionCount} {row.attentionCount === 1 ? "issue" : "issues"}
      </Badge>
    );
  }
  return <Badge variant="ok">Connected</Badge>;
}

function statusTag(row: AgencyClientRow) {
  if (row.connection === "waiting") return <Badge variant="warn">Onboarding</Badge>;
  if (row.locations === 0) return <Badge variant="default">No locations</Badge>;
  return <Badge variant="ok">Active</Badge>;
}

function Panel({ title, meta, children, className }: { title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-line bg-white", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {meta ? <div className="text-xs text-ink-3">{meta}</div> : null}
      </div>
      {children}
    </section>
  );
}

function PortfolioTabs({
  active,
  showUsage,
  totalClients,
  clientId,
  rangeParams,
  query,
}: {
  active: "businesses" | "usage";
  showUsage: boolean;
  totalClients: number;
  clientId: string;
  rangeParams: Record<string, string>;
  query: string;
}) {
  const tabs: PageTab[] = [
    {
      label: "Businesses",
      href: portfolioHref("/portfolio", clientId, rangeParams, query),
      active: active === "businesses",
      count: totalClients,
    },
  ];
  if (showUsage) {
    tabs.push({
      label: "Usage & budgets",
      href: portfolioHref("/portfolio/usage", clientId, rangeParams, query),
      active: active === "usage",
    });
  }
  return <PageTabs tabs={tabs} />;
}

interface AttentionItem {
  id: string;
  tag: ReactNode;
  body: ReactNode;
  href: string;
  action: string;
}

function attentionAcrossClients(data: AgencyHome, reviewsFor: (clientId: string, filter?: string) => string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const row of data.rows) {
    if (row.connection === "attention") {
      items.push({
        id: `conn-${row.id}`,
        tag: <Badge variant="bad">Connection</Badge>,
        body: (
          <>
            <b className="font-semibold text-ink">{row.name}</b> · {row.attentionCount}{" "}
            {row.attentionCount === 1 ? "Google connection needs" : "Google connections need"} attention.
          </>
        ),
        href: `/businesses/${row.id}`,
        action: "Open business",
      });
    } else if (row.connection === "waiting") {
      items.push({
        id: `wait-${row.id}`,
        tag: <Badge variant="warn">Onboarding</Badge>,
        body: (
          <>
            <b className="font-semibold text-ink">{row.name}</b> · waiting for the client to connect Google.
          </>
        ),
        href: `/businesses/${row.id}`,
        action: "Create link",
      });
    }
    if (row.escalations > 0) {
      items.push({
        id: `esc-${row.id}`,
        tag: <Badge variant="bad">Escalations</Badge>,
        body: (
          <>
            <b className="font-semibold text-ink">{row.name}</b> · {n(row.escalations)} open{" "}
            {row.escalations === 1 ? "escalation" : "escalations"}.
          </>
        ),
        href: withParams("/escalations", { client: row.id }),
        action: "Open queue",
      });
    }
    if (row.clientApprovals > 0) {
      items.push({
        id: `appr-${row.id}`,
        tag: <Badge variant="brand">Client approval</Badge>,
        body: (
          <>
            <b className="font-semibold text-ink">{row.name}</b> · {n(row.clientApprovals)}{" "}
            {row.clientApprovals === 1 ? "reply is" : "replies are"} waiting for the client.
          </>
        ),
        href: `/businesses/${row.id}`,
        action: "Review",
      });
    }
    if (row.reviewCount > 0 && row.unreplied > 0 && row.replyRate !== null && row.replyRate < 50) {
      items.push({
        id: `reply-${row.id}`,
        tag: <Badge variant="default">Needs reply</Badge>,
        body: (
          <>
            <b className="font-semibold text-ink">{row.name}</b> · reply rate {row.replyRate}%, {n(row.unreplied)} without a
            reply.
          </>
        ),
        href: reviewsFor(row.id, "unanswered"),
        action: "Reply",
      });
    }
  }
  return items;
}

export function AgencyHomeView({
  workspaceId,
  canSync,
  data,
  clientId,
  rangeParams,
  rangeLabel,
  query,
  showUsage,
}: AgencyHomeViewProps) {
  const { kpis, rows, totalClients, page, pageSize } = data;
  const from = totalClients === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalClients);
  const pageCount = Math.max(1, Math.ceil(totalClients / pageSize));
  const queueHref = clientId ? `/businesses/${clientId}` : "/locations";
  const reviewsFor = (id: string, filter?: string) => withParams("/reviews", { client: id, filter: filter ?? "" });
  const scopedReviews = (filter: string) => withParams("/reviews", { client: clientId, filter });
  const attention = attentionAcrossClients(data, reviewsFor);
  const filtered = Boolean(query || clientId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Portfolio"
        description={[
          `${n(kpis.clients)} ${kpis.clients === 1 ? "business" : "businesses"}`,
          `${n(kpis.locations)} ${kpis.locations === 1 ? "location" : "locations"}`,
          rangeLabel,
          "Pick a business to work in it",
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {showUsage ? (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={portfolioHref("/portfolio/usage", clientId, rangeParams, query)} />}
          >
            Usage &amp; budgets
          </Button>
        ) : null}
        {data.connectionId && canSync ? (
          <SyncLocationsButton connectionId={data.connectionId} />
        ) : data.connectionId ? null : (
          <Button nativeButton={false} render={<Link href="/settings" />}>
            Connect Google
          </Button>
        )}
      </PageHeader>

      <PortfolioTabs
        active="businesses"
        showUsage={showUsage}
        totalClients={totalClients}
        clientId={clientId}
        rangeParams={rangeParams}
        query={query}
      />

      <SetupChecklist
        workspaceId={workspaceId}
        canSync={canSync}
        hasConnection={data.hasConnection}
        hasLocations={kpis.locations > 0}
        hasReviews={data.hasReviews}
        hasPublished={data.hasPublished}
      />

      <KpiGrid>
        <KpiTile label="Businesses" value={n(kpis.clients)} detail={filtered ? "Matching this search" : "Active in this workspace"} />
        <KpiTile label="Locations" value={n(kpis.locations)} detail="Assigned to these businesses" href="/locations" />
        <KpiTile
          label="Needs reply · all businesses"
          value={n(kpis.unreplied)}
          detail="Reviews without a Google reply"
          href={scopedReviews("unanswered")}
        />
        <KpiTile
          label="Awaiting client approval"
          value={n(kpis.waitingApproval)}
          detail="Approving does not publish"
          href={queueHref}
        />
        <KpiTile
          label="Open escalations"
          value={n(kpis.openEscalations)}
          detail="Across these businesses"
          href={withParams("/escalations", { client: clientId })}
          tone={kpis.openEscalations > 0 ? "bad" : undefined}
        />
        <KpiTile
          label="Connection problems"
          value={n(kpis.connectionProblems)}
          detail={kpis.connectionProblems === 1 ? "Business with an issue" : "Businesses with an issue"}
          href="/locations"
          tone={kpis.connectionProblems > 0 ? "bad" : undefined}
        />
      </KpiGrid>

      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3">
          <form action="/portfolio" className="flex w-full flex-wrap items-center gap-2 sm:w-auto" role="search">
            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input
                name="q"
                defaultValue={query}
                placeholder="Search businesses or locations"
                aria-label="Search businesses"
                className="h-[30px] pl-8"
              />
            </div>
            {clientId ? <input type="hidden" name="client" value={clientId} /> : null}
            {Object.entries(rangeParams).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
            {query ? (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href={portfolioHref("/portfolio", clientId, rangeParams, "")} />}
              >
                Clear search
              </Button>
            ) : null}
          </form>
          <span className="text-xs text-ink-3">Open a business for its page; “Work in” sets the scope and opens Overview</span>
        </div>

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState
              bare
              icon={Search}
              title="No businesses match"
              description={query ? `Nothing matches “${query}”. Try another name or location.` : "No business matches this scope."}
            >
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={portfolioHref("/portfolio", "", rangeParams, "")} />}
              >
                Clear filters
              </Button>
            </EmptyState>
          ) : (
            <EmptyState
              bare
              title="No businesses yet"
              description={
                data.connectionId
                  ? "Click Sync profiles. Each brand on your Google account becomes a business."
                  : "Connect Google in Settings, then click Sync profiles."
              }
            >
              {data.connectionId ? null : (
                <Button size="sm" nativeButton={false} render={<Link href="/settings" />}>
                  Connect Google
                </Button>
              )}
            </EmptyState>
          )
        ) : (
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Business</TableHead>
                <TableHead className="text-right">Locations</TableHead>
                <TableHead className="text-right">Rating</TableHead>
                <TableHead className="text-right">Reply rate</TableHead>
                <TableHead className="text-right">Needs reply</TableHead>
                <TableHead className="text-right">Escalations</TableHead>
                <TableHead className="text-right">Client approval</TableHead>
                <TableHead>Account manager</TableHead>
                <TableHead>Connections</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const hasReviews = row.reviewCount > 0;
                return (
                  <TableRow key={row.id} className="border-line-2">
                    <TableCell className="px-4">
                      <Link href={`/businesses/${row.id}`} className="flex items-center gap-2 font-semibold text-ink hover:text-brand">
                        <span
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-tint text-[10px] font-semibold text-brand"
                          aria-hidden
                        >
                          {initials(row.name)}
                        </span>
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{n(row.locations)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRating(row.rating)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRate(row.replyRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {hasReviews && row.unreplied > 0 ? (
                        <Link href={reviewsFor(row.id, "unanswered")} className="hover:text-brand hover:underline">
                          {n(row.unreplied)}
                        </Link>
                      ) : (
                        formatCount(row.unreplied, hasReviews)
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", row.escalations > 0 && "font-semibold text-bad")}>
                      {n(row.escalations)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{n(row.clientApprovals)}</TableCell>
                    <TableCell className={row.manager ? "text-ink-2" : "text-ink-3"}>{row.manager ?? "Unassigned"}</TableCell>
                    <TableCell>{connectionTag(row)}</TableCell>
                    <TableCell>{statusTag(row)}</TableCell>
                    <TableCell className="px-4 text-right">
                      {row.connection === "waiting" ? (
                        <Button size="sm" nativeButton={false} render={<Link href={`/businesses/${row.id}`} />}>
                          Continue setup
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={withParams("/overview", { client: row.id })} />}
                          aria-label={`Work in ${row.name}`}
                        >
                          Work in ›
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 px-4 py-2.5 text-xs text-ink-3">
          <p>
            Showing {from}–{to} of {n(totalClients)} {totalClients === 1 ? "business" : "businesses"}
          </p>
          {pageCount > 1 ? (
            <nav className="flex gap-2" aria-label="Pages">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="xs"
                  nativeButton={false}
                  render={<Link href={portfolioHref("/portfolio", clientId, rangeParams, query, page - 1)} />}
                >
                  Previous
                </Button>
              ) : null}
              {page < pageCount ? (
                <Button
                  variant="outline"
                  size="xs"
                  nativeButton={false}
                  render={<Link href={portfolioHref("/portfolio", clientId, rangeParams, query, page + 1)} />}
                >
                  Next
                </Button>
              ) : null}
            </nav>
          ) : null}
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel
          title="Needs attention across clients"
          meta={pageCount > 1 ? "Businesses on this page" : undefined}
        >
          {attention.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-ink-3">Nothing on these businesses needs attention right now.</p>
          ) : (
            <ul className="divide-y divide-line-2 px-4">
              {attention.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-[13px] text-ink-2">
                  {item.tag}
                  <span className="min-w-0 flex-1">{item.body}</span>
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={item.href} />}>
                    {item.action}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Client approval queue">
          <div className="space-y-2 px-4 py-3 text-[13px] text-ink-2">
            <p>
              {data.approvals === 0
                ? "No replies are waiting for the client."
                : `${n(data.approvals)} ${data.approvals === 1 ? "reply is" : "replies are"} waiting for the client. Approving here does not publish to Google.`}
            </p>
            <Link href={queueHref} className="inline-block text-[13px] font-medium text-brand hover:underline">
              {clientId ? "Open this business" : "Open a business"}
            </Link>
            <p className="border-t border-line-2 pt-2 text-xs text-ink-3">
              Portfolio is the only page that spans businesses. “Work in” sets the scope bar to that business and opens Overview.
              {showUsage ? " Usage & budgets holds the per-business counts used for invoicing." : ""}
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function AgencyUsageView({ data, clientId, rangeParams, rangeLabel, query, showUsage }: PortfolioCommonProps) {
  const exportParams = new URLSearchParams();
  if (clientId) exportParams.set("client", clientId);
  for (const [key, value] of Object.entries(rangeParams)) exportParams.set(key, value);
  if (query) exportParams.set("q", query);
  const exportHref = `/api/usage/export${exportParams.size ? `?${exportParams}` : ""}`;
  const totals = data.usage.reduce(
    (sum, row) => ({
      locations: sum.locations + row.locations,
      reviews: sum.reviews + row.reviews,
      published: sum.published + row.publishedReplies,
      events: sum.events + row.recordedEvents,
    }),
    { locations: 0, reviews: 0, published: 0, events: 0 }
  );
  const queueHref = clientId ? `/businesses/${clientId}` : "/locations";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Portfolio"
        description={["Usage per business", rangeLabel ?? data.usageHeading, "Counts only, no price is calculated"].join(" · ")}
      >
        {showUsage ? <ExportUsageButton href={exportHref} /> : null}
      </PageHeader>

      <PortfolioTabs
        active="usage"
        showUsage={showUsage}
        totalClients={data.totalClients}
        clientId={clientId}
        rangeParams={rangeParams}
        query={query}
      />

      {!showUsage ? (
        <EmptyState
          title="Usage is for people who manage the workspace"
          description="Ask a workspace owner or admin for the usage figures, or for access to manage people."
        >
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/portfolio" />}>
            Back to businesses
          </Button>
        </EmptyState>
      ) : (
        <>
          <KpiGrid className="lg:grid-cols-4">
            <KpiTile label="Locations" value={n(totals.locations)} detail="Stored across these businesses" href="/locations" />
            <KpiTile label="Reviews stored" value={n(totals.reviews)} detail={data.usageHeading} />
            <KpiTile
              label="Replies published"
              value={n(totals.published)}
              detail={data.usageHeading}
              href={withParams("/reviews", { client: clientId, filter: "published", ...rangeParams })}
            />
            <KpiTile label="Recorded events" value={n(totals.events)} detail="Activity recorded for each business" />
          </KpiGrid>

          <Banner tone="neutral" title="AI budgets are not available yet.">
            Per-business AI spend and monthly budgets are not tracked here yet. The counts below are what the invoice export
            contains.
          </Banner>

          <Panel title={data.usageHeading} meta="Matches the invoice export">
            {data.usage.length === 0 ? (
              <EmptyState
                bare
                title="No usage in this period"
                description="Pick a longer period in the top bar, or clear the search on the Businesses tab."
              >
                {query || clientId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={portfolioHref("/portfolio/usage", "", rangeParams, "")} />}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </EmptyState>
            ) : (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Business</TableHead>
                    <TableHead className="text-right">Locations</TableHead>
                    <TableHead className="text-right">Reviews stored</TableHead>
                    <TableHead className="text-right">Replies published</TableHead>
                    <TableHead className="text-right">Recorded events</TableHead>
                    <TableHead>AI budget</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.usage.map((row) => (
                    <TableRow key={row.id} className="border-line-2">
                      <TableCell className="px-4">
                        <Link href={`/businesses/${row.id}`} className="font-semibold text-ink hover:text-brand">
                          {row.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{n(row.locations)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(row.reviews)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(row.publishedReplies)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(row.recordedEvents)}</TableCell>
                      <TableCell className="text-xs text-ink-3">Not available yet</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t border-line bg-[#fafbfc] font-semibold hover:bg-[#fafbfc]">
                    <TableCell className="px-4">Total</TableCell>
                    <TableCell className="text-right tabular-nums">{n(totals.locations)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(totals.reviews)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(totals.published)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(totals.events)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </Panel>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel title="What counts">
              <p className="px-4 py-3 text-xs leading-relaxed text-ink-3">
                Locations are the Google profiles assigned to each business. Reviews stored and replies published follow the
                period in the top bar. Recorded events are the activity logged for each business. No price is calculated; the
                export gives these counts per business for invoicing.
              </p>
            </Panel>
            <Panel title="Client approval queue">
              <div className="space-y-1 px-4 py-3 text-[13px] text-ink-2">
                <p>
                  {data.approvals === 0
                    ? "No replies are waiting for the client."
                    : `${n(data.approvals)} ${data.approvals === 1 ? "reply is" : "replies are"} waiting for the client. Approving here does not publish to Google.`}
                </p>
                <Link href={queueHref} className="inline-block font-medium text-brand hover:underline">
                  {clientId ? "Open this business" : "Open a business"}
                </Link>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
