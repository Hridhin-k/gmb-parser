import { PageLoading } from "@/components/page-loading";

export default function DashboardGroupLoading() {
  return (
    <PageLoading
      title="Loading this page"
      detail="Fetching the latest workspace data. The sidebar stays put while this finishes."
    />
  );
}
