import { PageLoading } from "@/components/page-loading";
import { PAGE_LOADING } from "@/lib/ui-status";

export default function OnboardingLoading() {
  const copy = PAGE_LOADING.onboarding;
  return (
    <PageLoading variant="analytics" title={copy.title} detail={copy.detail} tone={copy.tone} />
  );
}
