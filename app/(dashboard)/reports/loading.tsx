import { PageLoading } from "@/components/page-loading";

export default function ReportsLoading() {
  return (
    <PageLoading
      variant="list"
      title="Loading reports"
      detail="Opening scheduled reports and alert rules."
    />
  );
}
