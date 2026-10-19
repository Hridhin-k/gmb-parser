import { PageLoading } from "@/components/page-loading";

export default function OverviewLoading() {
  return (
    <PageLoading
      variant="analytics"
      title="Opening overview"
      detail="Counting ratings, replies, and the locations that need attention."
    />
  );
}
