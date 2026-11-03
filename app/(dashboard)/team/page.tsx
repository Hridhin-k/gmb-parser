import { redirect } from "next/navigation";
import { getActiveRole } from "@/lib/services/session";
import { canOpenPath } from "@/lib/shell";
import { settingsRedirect } from "@/lib/settings-redirect";

/** Team now lives in Settings. Old links keep their filters (status, role). */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canOpenPath("/team", role)) redirect("/overview");
  redirect(settingsRedirect("team", await searchParams));
}
