import { PageLoading } from "@/components/page-loading";

export default function SettingsLoading() {
  return (
    <PageLoading
      variant="settings"
      title="Loading settings"
      detail="Checking Google connections, team members, and workspace preferences."
    />
  );
}
