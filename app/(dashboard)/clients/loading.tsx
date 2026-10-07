import { PageLoading } from "@/components/page-loading";

export default function ClientsLoading() {
  return (
    <PageLoading
      variant="clients"
      title="Loading businesses"
      detail="Fetching each client and the Google locations assigned to it."
    />
  );
}
