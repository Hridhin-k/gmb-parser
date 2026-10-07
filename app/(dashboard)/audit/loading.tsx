import { PageLoading } from "@/components/page-loading";

export default function AuditLoading() {
  return (
    <PageLoading
      variant="audit"
      title="Loading activity"
      detail="Pulling the latest connections, syncs, drafts, and publishes for this workspace."
    />
  );
}
