import { PageLoading } from "@/components/page-loading";
import { PAGE_LOADING } from "@/lib/ui-status";

export default function TeamLoading() {
  const copy = PAGE_LOADING.team;
  return (
    <PageLoading variant="settings" title={copy.title} detail={copy.detail} tone={copy.tone} />
  );
}
