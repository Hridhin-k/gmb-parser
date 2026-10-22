import { PlatformOpsBoard } from "@/components/platform-ops-board";
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
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] leading-[1.2] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Platform ops</h1>
        <p className="mt-1 text-sm font-light text-slate">Bulk invites, access-request approvals, announcements, and maintenance mode.</p>
      </div>
      <PlatformOpsBoard requests={requests} announcements={announcements} maintenance={maintenance} />
    </div>
  );
}
