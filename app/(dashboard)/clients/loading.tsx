import { PageLoading } from "@/components/page-loading";
import { PAGE_LOADING } from "@/lib/ui-status";

export default function ClientsLoading() {
  const copy = PAGE_LOADING.clients;
  return (
    <PageLoading variant="clients" title={copy.title} detail={copy.detail} tone={copy.tone} />
  );
}
