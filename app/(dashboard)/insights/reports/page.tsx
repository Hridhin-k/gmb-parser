import { redirect } from "next/navigation";

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

/** Reports live on the Insights page for the same scope and dates. */
export default async function InsightReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const next = new URLSearchParams();
  for (const key of ["range", "from", "to", "client", "group", "location", "finding", "notice"] as const) {
    const value = one(params[key]);
    if (value) next.set(key, value);
  }
  const query = next.toString();
  redirect(query ? `/insights?${query}` : "/insights");
}
