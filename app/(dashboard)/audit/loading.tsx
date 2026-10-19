import { PageLoading } from "@/components/page-loading";
import { PAGE_LOADING } from "@/lib/ui-status";

export default function AuditLoading() {
  const copy = PAGE_LOADING.audit;
  return <PageLoading variant="audit" title={copy.title} detail={copy.detail} tone={copy.tone} />;
}
