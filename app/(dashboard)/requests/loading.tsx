import { PageLoading } from "@/components/page-loading";
import { PAGE_LOADING } from "@/lib/ui-status";

export default function RequestsLoading() {
  const copy = PAGE_LOADING.requests;
  return <PageLoading variant="list" title={copy.title} detail={copy.detail} tone={copy.tone} />;
}
