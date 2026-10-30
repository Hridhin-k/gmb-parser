import Link from "next/link";
import { Link2, Plus, QrCode } from "lucide-react";
import { CopyReviewLink } from "@/components/copy-review-link";
import { FreshMetrics } from "@/components/fresh-metrics";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageTabs } from "@/components/page-header";
import { RequestBoard, type RequestView } from "@/components/request-board";
import { RequestsPolicyCard } from "@/components/requests-policy-card";
import { Button } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { ensureLocationQr, loadRequestBoard, type QrSummary } from "@/lib/services/request-campaigns";
import { listReviewRequestLocations } from "@/lib/services/review-requests";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { overviewQueryKey } from "@/lib/overview-board";
import { isManager } from "@/lib/shell";
import { validateFilterString } from "@/lib/validation";

interface RequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = ["campaigns", "new", "qr", "links", "settings"] as const;
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
  const board = await loadRequestBoard(workspaceId);
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
      : "campaigns";
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
    if (tab !== "campaigns") next.set("tab", tab);
    const query = next.toString();
    return query ? `/requests?${query}` : "/requests";
  };
  const linkedLocations = locations.filter((location) => location.url);
  const metricHref = tabHref("campaigns");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Review requests"
        description="Invite customers to review a location on Google by WhatsApp, SMS, email or an in-store QR code. Every customer gets the same Google link; private feedback is an extra option, never a gate."
      >
        {locations.length > 0 ? (
          <Button variant="outline" nativeButton={false} render={<Link href={tabHref("qr")} />}>
            <QrCode aria-hidden />
            QR codes
          </Button>
        ) : null}
        {canManage && locations.length > 0 ? (
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

            <PageTabs
              tabs={[
                { label: "Campaigns", href: tabHref("campaigns"), active: view === "campaigns", count: campaigns.length },
                ...(canManage ? [{ label: "New campaign", href: tabHref("new"), active: view === "new" }] : []),
                { label: "QR codes", href: tabHref("qr"), active: view === "qr", count: locations.length },
                { label: "Google links", href: tabHref("links"), active: view === "links", count: linkedLocations.length },
                { label: "Limits & channels", href: tabHref("settings"), active: view === "settings" },
              ]}
            />

            {view === "links" ? (
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="overflow-hidden rounded-lg border border-line bg-white">
                  <div className="border-b border-line px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">Google review links</h2>
                    <p className="mt-0.5 text-xs text-ink-3">
                      These open Google’s review form directly. They do not record a visit in RevuPilot.
                    </p>
                  </div>
                  {linkedLocations.length === 0 ? (
                    <EmptyState
                      bare
                      icon={Link2}
                      title="No Google review links yet"
                      description="Google has not shared a place ID for these locations, so a direct review link can’t be built. Use the request page or QR code instead."
                    />
                  ) : (
                    <ul className="divide-y divide-line-2">
                      {linkedLocations.map((location) => (
                        <li key={location.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-ink">{location.name}</p>
                            {location.storeCode ? <p className="text-xs text-ink-3">{location.storeCode}</p> : null}
                          </div>
                          {location.url ? <CopyReviewLink url={location.url} /> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <RequestsPolicyCard policyDays={board.policyDays} />
              </div>
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
