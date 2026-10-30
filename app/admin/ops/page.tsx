import { PlatformOpsBoard } from "@/components/platform-ops-board";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/services/session";
import { getMaintenance, listAccessRequests, listAnnouncements } from "@/lib/services/platform";

export default async function PlatformOpsPage() {
  const user = await getCurrentUser();
  const [requests, announcements, maintenance] = await Promise.all([
    listAccessRequests(user!).catch(() => []),
    listAnnouncements(user!).catch(() => []),
    getMaintenance().catch(() => ({ enabled: false, message: null as string | null })),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Operations"
        description="Access-request approvals, bulk invites, announcements and maintenance mode. Announcements and maintenance are visible to every tenant, so each has a preview."
      >
        <a href="#maintenance" className={buttonVariants({ variant: "outline" })}>Maintenance</a>
        <a href="#announcement" className={buttonVariants({ variant: "default" })}>New announcement</a>
      </PageHeader>
      <PlatformOpsBoard requests={requests} announcements={announcements} maintenance={maintenance} />
    </div>
  );
}
