import { PageLoading } from "@/components/page-loading";

export default function OnboardingLoading() {
  return (
    <PageLoading
      variant="analytics"
      title="Opening setup"
      detail="Loading Google connections, locations, and saved progress."
    />
  );
}
