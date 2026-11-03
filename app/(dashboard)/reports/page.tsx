import { redirect } from "next/navigation";
import { reportsRedirect } from "@/lib/insights-links";

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Reports and alerts is a tab on Insights now. Old links keep their place, dates and section. */
export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  redirect(reportsRedirect(await searchParams));
}
