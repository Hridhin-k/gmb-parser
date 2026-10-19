import { PageLoading } from "@/components/page-loading";

export default function ClientDetailLoading() {
  return (
    <PageLoading
      variant="client"
      title="Loading this business…"
      detail="Gathering locations, ratings, and recent reviews for the selected client."
    />
  );
}
