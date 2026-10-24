import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/login-form";
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
  const [params, supabase] = await Promise.all([searchParams, createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <LoginForm
        methods={authMethodsFromEnv()}
        initialError={loginErrorMessage(errorCode, errorReason)}
      />
    </div>
  );
}
