import { PageLoading } from "@/components/page-loading";

export default function AnalyticsLoading() {
  return (
    <PageLoading
      variant="analytics"
      title="Crunching analytics"
      detail="Counting reviews, ratings, and reply times for the selected period."
    />
  );
}
