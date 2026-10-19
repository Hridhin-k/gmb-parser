import { PageLoading } from "@/components/page-loading";

export default function RequestsLoading() {
  return (
    <PageLoading
      variant="list"
      title="Loading review requests"
      detail="Opening campaigns, QR codes, and the request limit."
    />
  );
}