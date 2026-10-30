import { PageLoading } from "@/components/page-loading";

export default function AdminLoading() {
  return (
    <PageLoading
      variant="list"
      title="Loading platform data…"
      detail="Reading tenants, users and health from the live tables. The admin sidebar stays available."
    />
  );
}
