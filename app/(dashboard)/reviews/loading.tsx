import { PageLoading } from "@/components/page-loading";

export default function ReviewsLoading() {
  return (
    <PageLoading
      variant="reviews"
      title="Loading reviews"
      detail="Opening the inbox. Drafts and published replies will appear with each review."
    />
  );
}
