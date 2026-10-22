import { redirect } from "next/navigation";
import { OnboardingWizardLoader } from "@/components/onboarding-wizard-loader";
import { PageHeader } from "@/components/page-header";
import { googleConnectError } from "@/lib/onboarding";
import { getOnboardingView } from "@/lib/services/onboarding";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { isManager } from "@/lib/shell";
import { toUserMessage } from "@/lib/errors";

interface OnboardingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const role = await getActiveRole();
  if (!isManager(role)) redirect("/overview");

  const [params, { workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const requested = typeof params.step === "string" ? params.step : null;
  const googleError = typeof params.google_error === "string" ? params.google_error : null;
  const googleConnected = params.google_connected === "true";

  let data: Awaited<ReturnType<typeof getOnboardingView>> | null = null;
  let failure: string | null = null;
  try {
    data = await getOnboardingView(workspaceId);
  } catch (error) {
    failure = toUserMessage(error);
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Setup"
          description="Connect Google, import locations, confirm groups, set a reply tone, and invite the team."
        />
        <p className="rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite" role="alert">
          {failure ?? "Setup could not be loaded."}
        </p>
      </div>
    );
  }
  return (
    <OnboardingWizardLoader
      data={data}
      requestedStep={requested}
      notice={googleConnectError(googleError)}
      connected={googleConnected}
      canInviteAdmin={role === "owner"}
    />
  );
}
