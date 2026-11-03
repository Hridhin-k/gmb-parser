import Link from "next/link";
import { Link2, Plus } from "lucide-react";
import { GetReviewsShare, type ShareLocation } from "@/components/get-reviews-share";
import { FreshMetrics } from "@/components/fresh-metrics";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageTabs } from "@/components/page-header";
import { RequestBoard, type RequestView } from "@/components/request-board";
import { Button } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { ensureLocationQr, loadRequestBoard, type QrSummary } from "@/lib/services/request-campaigns";
import { listReviewRequestLocations } from "@/lib/services/review-requests";
import { listUnassignedClientIds } from "@/lib/services/unassigned-client";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { overviewQueryKey } from "@/lib/overview-board";
import { isManager } from "@/lib/shell";
import { validateFilterString } from "@/lib/validation";

interface RequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// "share" is the everyday view; the rest are the campaign tools. "links" was the old Google links tab.
const VIEWS = ["share", "campaigns", "new", "qr", "links", "settings"] as const;
type PageView = (typeof VIEWS)[number];

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([searchParams, getActiveWorkspace(), getActiveRole()]);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const clientId = resolved.clientId ?? "";
  const campaignParam = validateFilterString(params.campaign);
  const locations = await listReviewRequestLocations(
    workspaceId,
    resolved.blocked || resolved.level !== "organisation" ? null : clientId || null,
    { locationIds: resolved.blocked || resolved.level !== "organisation" ? resolved.locationIds : null }
  );
  if (locations.length > 0) await ensureLocationQr(workspaceId, locations.map((location) => location.id));
  const [board, unassignedClientIds] = await Promise.all([loadRequestBoard(workspaceId), listUnassignedClientIds(workspaceId)]);
  const locationIds = new Set(locations.map((location) => location.id));
  const campaigns = resolved.level !== "organisation" || clientId
    ? board.campaigns.filter((campaign) => campaign.locationIds.some((id) => locationIds.has(id)))
    : board.campaigns;
  const qrByLocation: Record<string, QrSummary> = {};
  for (const location of locations) {
    const qr = board.qrByLocation.get(location.id);
    if (qr) qrByLocation[location.id] = qr;
  }

  const canManage = isManager(role);
  const reviewId = UUID.test(campaignParam) ? campaignParam : null;
  const tabParam = typeof params.tab === "string" ? params.tab : "";
  let view: PageView = (VIEWS as readonly string[]).includes(tabParam)
    ? (tabParam as PageView)
    : reviewId
      ? "new"
      : "share";
  if (view === "links") view = "share";
  if (view === "new" && !canManage) view = "campaigns";

  // Keep the shared scope and period params on every tab link.
  const base = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || key === "campaign" || key === "page") continue;
    if (typeof value === "string") base.set(key, value);
  }
  const baseQuery = base.toString();
  const tabHref = (tab: PageView) => {
    const next = new URLSearchParams(base);
    if (tab !== "share") next.set("tab", tab);
    const query = next.toString();
    return query ? `/requests?${query}` : "/requests";
  };
  const metricHref = tabHref("campaigns");
  const campaignTab = view !== "share";
  const shareLocations: ShareLocation[] = locations.map((location) => ({
    id: location.id,
    name: location.name,
    // A location still in the Unassigned pool has no business name to thank customers with.
    businessName:
      location.clientName && !unassignedClientIds.includes(location.clientId ?? "") ? location.clientName : "us",
    googleUrl: location.url,
    pageUrl: qrByLocation[location.id]?.url ?? null,
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Get reviews" description="Send happy customers straight to the Google review box.">
        {canManage && locations.length > 0 && campaignTab ? (
          <Button nativeButton={false} render={<Link href={tabHref("new")} />}>
            <Plus aria-hidden />
            New campaign
          </Button>
        ) : null}
      </PageHeader>

      <FreshMetrics
        rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
        surface="requests"
      >
        {locations.length === 0 ? (
          <EmptyState
            icon={Link2}
            title={clientId ? "No locations for this business" : "No locations yet"}
            description={
              clientId
                ? "Choose all businesses in the scope bar, or sync this business’s Google profiles."
                : "Connect Google and sync profiles. Each location can then have a request page and a QR code."
            }
          >
            <Button variant="outline" nativeButton={false} render={<Link href="/locations" />}>
              Open locations
            </Button>
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            <PageTabs
              tabs={[
                { label: "Share", href: tabHref("share"), active: view === "share" },
                { label: "Campaigns", href: tabHref("campaigns"), active: view === "campaigns" || view === "new", count: campaigns.length },
                { label: "All QR codes", href: tabHref("qr"), active: view === "qr", count: locations.length },
                { label: "Limits & channels", href: tabHref("settings"), active: view === "settings" },
              ]}
            />

            {view === "campaigns" || view === "new" ? (
              <KpiGrid>
                {board.metrics.map((metric) => (
                  <KpiTile
                    key={metric.id}
                    label={metric.label}
                    value={metric.value}
                    detail={metric.note}
                    href={["sent", "delivered", "opened", "clicked"].includes(metric.id) ? metricHref : undefined}
                  />
                ))}
              </KpiGrid>
            ) : null}

            {view === "share" ? (
              <GetReviewsShare locations={shareLocations} initialId={typeof params.location === "string" ? params.location : null} />
            ) : (
              <RequestBoard
                view={view as RequestView}
                canManage={canManage}
                channels={board.channels}
                metrics={board.metrics}
                campaigns={campaigns}
                locations={locations.map((location) => ({
                  id: location.id,
                  name: location.name,
                  storeCode: location.storeCode,
                  url: location.url,
                }))}
                qrByLocation={qrByLocation}
                policyDays={board.policyDays}
                reviewId={reviewId}
                clientId={clientId}
                baseQuery={baseQuery}
              />
            )}
          </div>
        )}
      </FreshMetrics>
    </div>
  );
}
