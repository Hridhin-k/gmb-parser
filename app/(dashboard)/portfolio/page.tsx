import { AgencyHomeView } from "@/components/agency-home";
import { loadPortfolio, type PortfolioSearchParams } from "./load-portfolio";

interface PortfolioPageProps {
  searchParams: Promise<PortfolioSearchParams>;
}

export default async function PortfolioPage({ searchParams }: PortfolioPageProps) {
  const portfolio = await loadPortfolio(searchParams, "/portfolio");
  return (
    <AgencyHomeView
      workspaceId={portfolio.workspaceId}
      canSync={portfolio.canSync}
      data={portfolio.data}
      clientId={portfolio.clientId}
      rangeParams={portfolio.rangeParams}
      rangeLabel={portfolio.rangeLabel}
      query={portfolio.query}
      showUsage={portfolio.showUsage}
    />
  );
}
