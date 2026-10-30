import { AgencyUsageView } from "@/components/agency-home";
import { loadPortfolio, type PortfolioSearchParams } from "../load-portfolio";

interface PortfolioUsagePageProps {
  searchParams: Promise<PortfolioSearchParams>;
}

export default async function PortfolioUsagePage({ searchParams }: PortfolioUsagePageProps) {
  const portfolio = await loadPortfolio(searchParams, "/portfolio/usage");
  return (
    <AgencyUsageView
      data={portfolio.data}
      clientId={portfolio.clientId}
      rangeParams={portfolio.rangeParams}
      rangeLabel={portfolio.rangeLabel}
      query={portfolio.query}
      showUsage={portfolio.showUsage}
    />
  );
}
