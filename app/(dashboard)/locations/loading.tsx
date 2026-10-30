import { PageLoading } from "@/components/page-loading";

export default function Loading() {
  return (
    <PageLoading
      variant="clients"
      title="Loading locations…"
      detail="Reading businesses, groups and Google connection status for this workspace."
    />
  );
}
