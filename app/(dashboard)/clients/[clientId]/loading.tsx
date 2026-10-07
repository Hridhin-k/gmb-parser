import { PageLoading } from "@/components/page-loading";

export default function ClientDetailLoading() {
  return (
    <PageLoading
      variant="client"
      title="Loading business"
      detail="Gathering this client’s locations, ratings, and recent reviews."
    />
  );
}
