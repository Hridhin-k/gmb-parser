import { PageLoading } from "@/components/page-loading";
import { PAGE_LOADING } from "@/lib/ui-status";

export default function EscalationsLoading() {
  const copy = PAGE_LOADING.escalations;
  return (
    <PageLoading variant="reviews" title={copy.title} detail={copy.detail} tone={copy.tone} />
  );
}
