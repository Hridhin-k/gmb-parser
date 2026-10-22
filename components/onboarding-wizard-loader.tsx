"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";
import type { OnboardingView } from "@/lib/services/onboarding";

export interface OnboardingWizardLoaderProps {
  data: OnboardingView;
  requestedStep: string | null;
  notice: string | null;
  connected: boolean;
  canInviteAdmin: boolean;
}

// Code splitting only works from a Client Component (dynamic imports from a
// Server Component are not split), so this thin loader keeps the wizard out
// of the /onboarding route bundle until the page renders it.
const OnboardingWizard = dynamic(
  () => import("@/components/onboarding-wizard").then((m) => m.OnboardingWizard),
  {
    loading: () => (
      <div className="flex items-center justify-center p-8">
        <Spinner />
      </div>
    ),
  }
);

export function OnboardingWizardLoader(props: OnboardingWizardLoaderProps) {
  return <OnboardingWizard {...props} />;
}
