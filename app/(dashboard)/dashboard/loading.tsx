import { PageLoading } from "@/components/page-loading";

export default function ClientsHomeLoading() {
  return (
    <PageLoading
      variant="clients"
      title="Loading clients"
      detail="Adding up locations, unreplied reviews, and connection status for this workspace."
    />
  );
}
