import { redirect } from "next/navigation";
import { OnboardingWizardLoader } from "@/components/onboarding-wizard-loader";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
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
          description="Connect Google, import locations, organise groups, set a reply tone, and invite the team."
        />
        <Banner
          tone="bad"
          title="Setup could not be loaded."
          actions={
            <>
              <Link href="/onboarding" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Try again
              </Link>
              <Link href="/overview" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Go to Overview
              </Link>
            </>
          }
        >
          {failure ?? "Please try again in a moment."}
        </Banner>
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
