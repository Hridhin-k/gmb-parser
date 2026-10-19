import { PageLoading } from "@/components/page-loading";

export default function TeamLoading() {
  return (
    <PageLoading
      variant="settings"
      title="Opening the team"
      detail="Loading people and pending invites for this workspace."
    />
  );
}
