import { redirect } from "next/navigation";
import { getActiveRole } from "@/lib/services/session";
import { canOpenPath } from "@/lib/shell";
import { settingsRedirect } from "@/lib/settings-redirect";

/** Usage now lives in Settings › Plan and usage. Old links keep their scope and period. */
export default async function PortfolioUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canOpenPath("/portfolio/usage", role)) redirect("/overview");
  redirect(settingsRedirect("plan", await searchParams));
}
