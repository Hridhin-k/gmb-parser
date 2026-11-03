import { redirect } from "next/navigation";
import { getActiveRole } from "@/lib/services/session";
import { canOpenPath } from "@/lib/shell";
import { settingsRedirect } from "@/lib/settings-redirect";

/** The audit log now lives in Settings › Security. Old links keep their filters (action, user, entity, range, page). */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canOpenPath("/audit", role)) redirect("/overview");
  redirect(settingsRedirect("security", await searchParams));
}
