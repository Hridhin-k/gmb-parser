import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";
import { devLoginEnabled, localSignupEnabled } from "@/lib/auth/dev-login";
import { LoginForm } from "@/components/login-form";
import { PubNav, PubPage } from "@/components/pub-shell";
import { authMethodsFromEnv } from "@/lib/auth-methods";
import { loginErrorMessage, shouldEnterWizard } from "@/lib/onboarding";
import { hasUserConsent } from "@/lib/services/consent";
import { getOnboardingGate } from "@/lib/services/onboarding";
import { ensurePersonalWorkspace, getMemberRole } from "@/lib/services/workspace";
import { tenantGateRedirect } from "@/lib/services/session";
import { isSuperAdmin } from "@/lib/services/platform";
import { homePath, isManager } from "@/lib/shell";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);

  if (user) {
    if (isSuperAdmin(user)) redirect("/admin");
    if (!(await hasUserConsent(user.id))) redirect("/consent");
    let membership: Awaited<ReturnType<typeof ensurePersonalWorkspace>>;
    try {
      membership = await ensurePersonalWorkspace(user);
    } catch (error) {
      const target = tenantGateRedirect(error);
      if (target) redirect(target);
      throw error;
    }
    const [role, gate] = await Promise.all([
      getMemberRole(user.id, membership.workspace_id),
      getOnboardingGate(membership.workspace_id),
    ]);
    if (isManager(role) && shouldEnterWizard(gate)) redirect("/onboarding");
    redirect(homePath(role));
  }

  const errorCode = typeof params.error === "string" ? params.error : null;
  const errorReason = typeof params.reason === "string" ? params.reason : null;

  const cancelled = errorCode === "auth_failed" && errorReason === "access_denied";
  const openSignup = localSignupEnabled();

  return (
    <PubPage
      className="justify-center"
      nav={
        <PubNav>
          <span className="hidden sm:inline">{openSignup ? "New here? Sign in with Google to create a workspace." : "Invite-only. Ask your workspace owner for an invite."}</span>
        </PubNav>
      }
    >
      <LoginForm
        methods={authMethodsFromEnv()}
        localLogin={devLoginEnabled()}
        openSignup={openSignup}
        initialError={loginErrorMessage(errorCode, errorReason)}
        outcome={cancelled ? "cancelled" : errorCode ? "error" : null}
        errorRef={errorCode ? [errorCode, errorReason].filter(Boolean).join(" · ") : null}
      />
    </PubPage>
  );
}
