import { PageLoading } from "@/components/page-loading";
import { PAGE_LOADING } from "@/lib/ui-status";

export default function ReviewsLoading() {
  const copy = PAGE_LOADING.reviews;
  return <PageLoading variant="reviews" title={copy.title} detail={copy.detail} tone={copy.tone} />;
}
