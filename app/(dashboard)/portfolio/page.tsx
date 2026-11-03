import { redirect } from "next/navigation";
import type { PortfolioSearchParams } from "./load-portfolio";

interface PortfolioPageProps {
  searchParams: Promise<PortfolioSearchParams>;
}

/** Portfolio is part of Today now. Scope and period params are carried over. */
export default async function PortfolioPage({ searchParams }: PortfolioPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const qs = query.toString();
  redirect(qs ? `/overview?${qs}` : "/overview");
}
