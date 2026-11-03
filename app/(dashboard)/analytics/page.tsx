import { redirect } from "next/navigation";
import { analyticsRedirect } from "@/lib/insights-links";

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Analytics is part of Insights now. Old links keep their place and dates. */
export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  redirect(analyticsRedirect(await searchParams));
}
