import { PageLoading } from "@/components/page-loading";

export default function ClientsLoading() {
  return (
    <PageLoading
      variant="clients"
      title="Loading locations"
      detail="Fetching brands, groups, and the locations inside them."
    />
  );
}
