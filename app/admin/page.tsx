import { PlatformAdminBoard } from "@/components/platform-admin-board";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { getCurrentUser } from "@/lib/services/session";
import { loadPlatformOverview } from "@/lib/services/platform";
import { toUserMessage } from "@/lib/errors";
import { validatePage } from "@/lib/validation";

interface PageProps { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function AdminPage({ searchParams }: PageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  const q = typeof params.q === "string" ? params.q : "";
  const page = validatePage(params.page);
  const invitePage = validatePage(params.ipage);
  // Layout already gated; user is present and a super admin here.
  let overview: Awaited<ReturnType<typeof loadPlatformOverview>> | null = null;
  let failure: string | null = null;
  try {
    overview = await loadPlatformOverview(user!, { query: q, page, invitePage });
  } catch (error) {
    failure = toUserMessage(error);
  }
  const n = (value: number) => value.toLocaleString("en-US");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Tenants"
        description={
          overview
            ? `${n(overview.stats.tenants)} workspaces · ${n(overview.stats.members)} members. Only invited owners can create a workspace; suspended and deleted tenants are blocked at sign-in.`
            : "Manage SaaS tenants and the invites that create them."
        }
      >
        <a href="/admin/ops#access-requests" className={buttonVariants({ variant: "outline" })}>Access requests</a>
        <a href="#invite-tenant" className={buttonVariants({ variant: "default" })}>Invite a tenant</a>
      </PageHeader>
      {failure || !overview ? (
        <Banner tone="bad" title="Platform data could not be loaded.">
          {failure ?? null} Apply migration <code>20261022001_platform_invite_only.sql</code> if this is a new database.
        </Banner>
      ) : (
        <>
          <KpiGrid>
            <KpiTile label="Tenants" value={n(overview.stats.tenants)} detail="All workspaces, incl. grandfathered" />
            <KpiTile label="Active" value={n(overview.stats.active)} tone={overview.stats.active > 0 ? "ok" : undefined} detail="Members can sign in" />
            <KpiTile label="Suspended" value={n(overview.stats.suspended)} tone={overview.stats.suspended > 0 ? "warn" : undefined} detail="Blocked at sign-in, data kept" />
            <KpiTile label="Deleted" value={n(overview.stats.deleted)} detail="Soft-deleted, restorable" />
            <KpiTile label="Pending invites" value={n(overview.stats.pendingInvites)} href="#invites" detail="Waiting for the owner to sign in" />
            <KpiTile label="Reviews" value={n(overview.stats.reviews)} detail="Across every tenant" />
          </KpiGrid>
          <PlatformAdminBoard
            invites={overview.invites}
            inviteTotal={overview.inviteTotal}
            invitePage={overview.invitePage}
            invitePageSize={overview.invitePageSize}
            tenants={overview.tenants}
            tenantTotal={overview.tenantTotal}
            page={overview.page}
            pageSize={overview.pageSize}
            initialQuery={q}
          />
        </>
      )}
    </div>
  );
}
